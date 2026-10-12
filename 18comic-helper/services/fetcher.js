'use strict';

/**
 * 请求封装层（CloakBrowser CF 过盾版）
 *
 * 流程：
 *   1. 先检查 cf_clearance cookie 缓存
 *   2. 有缓存 → 带 cookie 直接请求
 *   3. 无缓存/过期 → CloakBrowser 过盾拿 cookie
 *   4. 请求时检测 CF 挑战 → 自动清除缓存并重新过盾
 *
 * 前提：WSL Ubuntu + cloakbrowser + xvfb + 字体
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const { exec, execSync } = require('child_process');
const { ProxyAgent } = require('proxy-agent');

const CONFIG = require('../config.js');
const { getComic18 } = require('../config.js');
const { getConfig } = require('../config.js');
const { getProxyUrl } = require('../config.js');
const cfEngine = require('./cf_engine.js');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const { proxyUrl, comic18 } = getConfig();

// 代理 Agent：所有请求都走 127.0.0.1:10808 代理出口
const proxyAgent = new ProxyAgent(getProxyUrl());

// 当前最小版：不重试，避免“你以为成功了但其实是 CF 挑战”。
const MAX_RETRY = 0;

function log(msg) {
  const d = new Date().toISOString();
  console.log(`[fetcher] ${d} ${msg}`);
}

function makeComic18Url(path) {
  const p = new URL(path, comic18.baseUrl);
  return comic18.baseUrl + p.pathname + p.search;
}

function isCloudflareChallenge(body, status) {
  const s = typeof body === 'string' ? body : body.toString('utf8');
  return (
    status === 403 ||
    /<html/i.test(s) &&
    /cloudflare|just a moment|_cf_clearance/i.test(s)
  );
}

function isLayoutChallengeBody(body) {
  const s = typeof body === 'string' ? body : body.toString('utf8');
  return (
    /<html/i.test(s) &&
    /challenge|just a moment|cf_chl/i.test(s)
  );
}

function getHttpMethod(method) {
  return method === 'GET' ? http : https;
}

/**
 * 最小版本只做一次请求，没有自动重试。
 * 以后如果要开重试，需要把：
 *   - CF 挑战误判
 *   - 自检时间长
 *   - 重试后收到真正内容
 * 这些条件写清楚。
 */
async function fetchViaProxy(relativePath, opts = {}) {
  const url = makeComic18Url(relativePath);
  const timeout = Number(opts.timeout || comic18.timeout.http);
  const method = opts.method || 'GET';

  log(`fetch via proxy: ${method} ${relativePath} -> ${url}`);

  return new Promise((resolve, reject) => {
    const lib = optionToAgent(method, url);

    const start = Date.now();
    const req = lib.request(
      {
        protocol: url.startsWith('https') ? 'https:' : 'http:',
        hostname: new URL(url).hostname,
        port: new URL(url).port || (url.startsWith('https') ? 443 : 80),
        path: new URL(url).pathname + new URL(url).search,
        method: method,
        headers: {
          Host: new URL(url).hostname,
          Referer: comic18.referer,
          'User-Agent': UA,
          Accept: '*/*',
        },
        timeout: timeout,
        rejectUnauthorized: false,
        agent: proxyAgent,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          const response = {
            status: res.statusCode,
            headers: res.headers,
            body: body,
            durationMs: Date.now() - start,
          };

          // 我们先把“到达但被 CF 拦住”和“真正业务成功”分开返回，方便你后面人工定位。
          if (isCloudflareChallenge(body, response.status)) {
            log(`fetch cf-challenge: ${relativePath} status=${response.status}`);
            return resolve(response);
          }

          if (isLayoutChallengeBody(body) && response.status >= 400) {
            log(`fetch cf-layout: ${relativePath} status=${response.status}`);
            return resolve(response);
          }

          log(`fetch ok: ${relativePath} status=${response.status}`);
          resolve(response);
        });
      }
    );

    req.on('error', (err) => {
      log(`fetch error: ${relativePath} error=${err.message}`);
      const body = Buffer.from(
        JSON.stringify({
          error: 'fetch_failed',
          detail: err.message,
          http_code: null,
        })
      );
      resolve({
        status: 502,
        headers: { 'content-type': 'application/json' },
        body: body,
        durationMs: Date.now() - start,
      });
    });

    req.setTimeout(timeout, () => {
      req.destroy(new Error(`request timeout after ${timeout}ms`));
    });

    req.end();
  });
}

/**
 * Options：
 *   method: 'GET' | 'POST' | ...
 *   timeout: ms
 *   headers: Object
 *   retries: not used in this minimal version
 */
async function request(relativePath, opts = {}) {
  const method = opts.method || 'GET';
  const url = makeComic18Url(relativePath);
  const timeout = Number(opts.timeout || comic18.timeout.default);

  return new Promise((resolve, reject) => {
    const lib = optionToAgent(method, url);

    const start = Date.now();
    const req = lib.request(
      {
        protocol: url.startsWith('https') ? 'https:' : 'http:',
        hostname: new URL(url).hostname,
        port: new URL(url).port || (url.startsWith('https') ? 443 : 80),
        path: new URL(url).pathname + new URL(url).search,
        method: method,
        headers: {
          Host: new URL(url).hostname,
          Referer: comic18.referer,
          'User-Agent': UA,
          Accept: '*/*',
          ...(opts.headers || {}),
        },
        timeout: timeout,
        rejectUnauthorized: false,
        agent: proxyAgent,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: body,
            durationMs: Date.now() - start,
          });
        });
      }
    );

    req.on('error', reject);
    req.setTimeout(timeout, () => {
      req.destroy(new Error(`request timeout after ${timeout}ms`));
    });
    req.end();
  });
}

/**
 * 收到真实“过 CF 了”的页面时，返回 200 + flag。
 * 用户/人工层可以用这个 flag 判断：
 *   - 是否需要手动续 cookie
 *   - 是否要切后端
 */
async function fetchRaw(relativePath, opts = {}) {
  const result = await fetchViaProxy(relativePath, opts);
  return {
    ...result,
    from: '18comic.vip',
    viaProxy: require('../config.js').getProxyUrl(),
    cfHandledByHelper: false,
  };
}

function optionToAgent(method, url) {
  // Use https if the target URL is https, regardless of method.
  // The method only affects whether the body/headers have a body.
  return url.startsWith('https') ? https : http;
}

module.exports = {
  fetchViaProxy,
  request,
  fetchRaw,
};
