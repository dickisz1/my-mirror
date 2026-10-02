/**
 * api/proxy.js —— 漫蛙漫画「书源代理」
 * ============================================================
 * 对应架构文章：
 *   第一步  请求被"截胡"      → vercel.json 把 /(.*) 全量转给本文件
 *   第二步  先返回前端界面    → 命中 / 时返回 manga_reader.html
 *   第三步  按书源规则取数据  → 本文件持有 BOOK_SOURCES 规则表，
 *                              数据请求转发 manwaxu.cc，
 *                              图片请求按备用 CDN 规则依次重试并解密
 *   第四步  浏览器渲染        → 前端拿到 JSON / 图片自行渲染
 *
 * 路由形态（显式携带目标路径，不依赖平台是否保留原始 path）：
 *   /api/proxy?p=/api/home&page=1&pageSize=12&type=0&flag=1
 *   /api/proxy?p=/api/comic/94789
 *   /api/proxy?p=/api/comic/94789/chapters
 *   /api/proxy?p=/api/comic/image/1361313&page=1&page_size=200&image_source=
 *   /api/proxy?p=/en_images/20255/94789/1361313/0.jpg
 *   /api/proxy?p=/api/source/rules
 * 同时兼容裸路径形态（/en_images/... 、/manga_reader.html）。
 * ============================================================
 */
'use strict';

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

/* ============================================================
 * 一、书源规则表
 * 本文件是权威副本；前端启动时通过 /api/source/rules 拉取，
 * 拉不到则退回前端内联的同一份默认值。
 * ============================================================ */
const BOOK_SOURCES = {
  name: '漫蛙漫画',
  version: '2.0.0',
  baseUrl: 'https://manwaxu.cc',
  referer: 'https://manwaxu.cc/',
  timeout: 12000,
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',

  /* ---- 备用 CDN 规则：依次重试，第一个成功即返回 ---- */
  imageCdn: [
    'https://tu.mhttu.cc',
    'https://mwtuwu.cc',
    'https://tu.mwzu.cc',
    'https://mwtusi.cc'
  ],

  /* ---- 图片解密规则（实测：前16字节=IV，其余=AES-256-CBC密文，PKCS#7） ---- */
  decrypt: {
    enabled: true,
    algo: 'aes-256-cbc',
    key: '0B6666A0-BB59-1381-B746-a0E4C9AC',
    keyBytes: 32,
    ivBytes: 16
  },

  /* ---- 取数规则：动作 → 目标路径模板 + 允许的参数 ---- */
  rules: {
    home: {
      desc: '首页列表',
      path: '/api/home',
      params: ['page', 'pageSize', 'type', 'flag'],
      match: /^\/api\/home$/
    },
    search: {
      desc: '搜索',
      path: '/api/search',
      params: ['keyword', 'page', 'pageSize'],
      match: /^\/api\/search$/
    },
    detail: {
      desc: '详情页',
      path: '/api/comic/{id}',
      params: [],
      match: /^\/api\/comic\/\d+$/
    },
    chapters: {
      desc: '章节列表',
      path: '/api/comic/{id}/chapters',
      params: [],
      match: /^\/api\/comic\/\d+\/chapters$/
    },
    chapInfo: {
      desc: '章节信息',
      path: '/api/comic/chapter/info/{cid}',
      params: [],
      match: /^\/api\/comic\/chapter\/info\/\d+$/
    },
    images: {
      desc: '图片列表',
      path: '/api/comic/image/{cid}',
      params: ['page', 'page_size', 'image_source'],
      match: /^\/api\/comic\/image\/\d+$/
    },
    announce: {
      desc: '公告',
      path: '/api/announcements',
      params: [],
      match: /^\/api\/announcements$/
    }
  },

  /* ---- 图片资源规则 ---- */
  imageRule: {
    desc: '图片资源',
    match: /^\/en_images\//,
    cdn: true,
    decrypt: true
  }
};

/* 允许放行的数据路径（防止本代理变成任意转发器） */
const ALLOWED_DATA = Object.keys(BOOK_SOURCES.rules).map(k => BOOK_SOURCES.rules[k].match);

/* ============================================================
 * 二、工具函数
 * ============================================================ */

/** 带超时 + 重定向跟随的 GET */
function fetchRaw(urlStr, headers, timeout, redirects) {
  redirects = redirects === undefined ? 3 : redirects;
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch (e) { return reject(e); }
    const lib = u.protocol === 'http:' ? http : https;

    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'http:' ? 80 : 443),
        path: u.pathname + u.search,
        method: 'GET',
        headers: headers,
        timeout: timeout,
        rejectUnauthorized: false
      },
      res => {
        if (
          [301, 302, 303, 307, 308].indexOf(res.statusCode) >= 0 &&
          res.headers.location &&
          redirects > 0
        ) {
          res.resume();
          const next = new URL(res.headers.location, urlStr).toString();
          return fetchRaw(next, headers, timeout, redirects - 1).then(resolve, reject);
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })
        );
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('upstream timeout')));
    req.end();
  });
}

/* ---- 图片魔数嗅探 ---- */
const IMG_MAGIC = [
  { mime: 'image/jpeg', sig: Buffer.from([0xff, 0xd8, 0xff]) },
  { mime: 'image/png', sig: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
  { mime: 'image/gif', sig: Buffer.from([0x47, 0x49, 0x46, 0x38]) },
  { mime: 'image/webp', sig: Buffer.from([0x52, 0x49, 0x46, 0x46]) },
  { mime: 'image/bmp', sig: Buffer.from([0x42, 0x4d]) }
];

function sniffMime(buf) {
  if (!buf || buf.length < 4) return null;
  for (let i = 0; i < IMG_MAGIC.length; i++) {
    const x = IMG_MAGIC[i];
    if (buf.subarray(0, x.sig.length).equals(x.sig)) return x.mime;
  }
  return null;
}

/** 按解密规则解密图片；已是明文图片则原样返回 */
function decryptImage(buf) {
  const plainMime = sniffMime(buf);
  if (plainMime) return { body: buf, mime: plainMime, decrypted: false };

  const rule = BOOK_SOURCES.decrypt;
  if (!rule.enabled) return { body: buf, mime: 'image/jpeg', decrypted: false };

  const key = Buffer.from(rule.key, 'utf8').subarray(0, rule.keyBytes);
  const iv = buf.subarray(0, rule.ivBytes);
  const ct = buf.subarray(rule.ivBytes);
  if (ct.length === 0 || ct.length % 16 !== 0) {
    return { body: buf, mime: 'application/octet-stream', decrypted: false };
  }
  try {
    const d = crypto.createDecipheriv(rule.algo, key, iv);
    const out = Buffer.concat([d.update(ct), d.final()]);
    const mime = sniffMime(out);
    if (!mime) return { body: buf, mime: 'application/octet-stream', decrypted: false };
    return { body: out, mime: mime, decrypted: true };
  } catch (e) {
    return { body: buf, mime: 'application/octet-stream', decrypted: false };
  }
}

/** 统一请求头（Referer 是这些站点的硬性要求） */
function upstreamHeaders(req) {
  return {
    Referer: BOOK_SOURCES.referer,
    Origin: BOOK_SOURCES.baseUrl,
    'User-Agent': req.headers['user-agent'] || BOOK_SOURCES.userAgent,
    Accept: '*/*'
  };
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
}

/* ---- 前端界面读取（第二步） ---- */
let _htmlCache = null;
function readFrontend() {
  if (_htmlCache) return _htmlCache;
  const candidates = [
    path.join(process.cwd(), 'manga_reader.html'),
    path.join(__dirname, '..', 'manga_reader.html'),
    path.join(__dirname, 'manga_reader.html')
  ];
  for (let i = 0; i < candidates.length; i++) {
    try {
      _htmlCache = fs.readFileSync(candidates[i], 'utf8');
      return _htmlCache;
    } catch (e) { /* 试下一个 */ }
  }
  return null;
}

/* ============================================================
 * 三、处理器
 * ============================================================ */

/** 第二步：先返回前端界面 */
function serveFrontend(res) {
  const html = readFrontend();
  if (html) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(html);
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(500).send(
    '<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:40px">' +
      '<h2>前端界面未打包</h2>' +
      '<p>proxy 未能读到 <code>manga_reader.html</code>。请在 <code>vercel.json</code> 中确认：</p>' +
      '<pre>{ "functions": { "api/proxy.js": { "includeFiles": "manga_reader.html" } } }</pre>' +
      '</body>'
  );
}

/** 书源规则接口 */
function serveRules(res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.status(200).send(JSON.stringify(BOOK_SOURCES));
}

/** 第三步-A：按书源规则取数据（转发 manwaxu.cc） */
async function serveData(target, query, req, res) {
  const upstream = BOOK_SOURCES.baseUrl + target + (query ? '?' + query : '');
  try {
    const r = await fetchRaw(upstream, upstreamHeaders(req), BOOK_SOURCES.timeout);
    setCors(res);
    res.setHeader('Content-Type', r.headers['content-type'] || 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(r.status).send(r.body);
  } catch (err) {
    setCors(res);
    return res.status(502).json({
      error: err.message,
      rule: 'data',
      target: upstream,
      source: BOOK_SOURCES.name
    });
  }
}

/** 第三步-B：按备用 CDN 规则取图片 + 解密 */
async function serveImage(target, req, res) {
  const rel = target; // 形如 /en_images/20255/94789/1361313/0.jpg
  const hosts = BOOK_SOURCES.imageCdn;
  const tried = [];
  let lastErr = null;

  for (let i = 0; i < hosts.length; i++) {
    const base = hosts[i].replace(/\/+$/, '');
    const upstream = base + rel;
    try {
      const r = await fetchRaw(upstream, upstreamHeaders(req), BOOK_SOURCES.timeout);
      if (r.status === 200 && r.body && r.body.length > 0) {
        const dec = decryptImage(r.body);
        setCors(res);
        res.setHeader('Content-Type', dec.mime);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.setHeader('X-Source-Host', base);
        res.setHeader('X-Source-Decrypted', dec.decrypted ? '1' : '0');
        res.setHeader('X-Source-Rule', 'image');
        return res.status(200).send(dec.body);
      }
      tried.push({ host: base, status: r.status });
      lastErr = new Error('HTTP ' + r.status + ' from ' + base);
    } catch (e) {
      tried.push({ host: base, status: 'ERR', msg: e.message });
      lastErr = e;
    }
  }

  setCors(res);
  return res.status(502).json({
    error: lastErr ? lastErr.message : 'all cdn failed',
    rule: 'image',
    target: rel,
    tried: tried,
    source: BOOK_SOURCES.name
  });
}

/* ============================================================
 * 四、入口
 * ============================================================ */
module.exports = async function handler(req, res) {
  const host = req.headers.host || 'localhost';
  const url = new URL(req.url, 'https://' + host);

  // 防御：部分部署形态下 req.url 会带上 /api/proxy 前缀
  const pathname = url.pathname.replace(/^\/api\/proxy/, '') || '/';
  const sp = url.searchParams;

  if (req.method === 'OPTIONS') {
    setCors(res);
    return res.status(204).end();
  }

  // 显式目标优先，裸路径兜底
  let target = sp.get('p') || pathname;
  if (target.charAt(0) !== '/') target = '/' + target;

  // 转发时剔除内部参数 p
  const rest = new URLSearchParams(sp);
  rest.delete('p');
  const query = rest.toString();

  /* --- 第二步：先返回前端界面 --- */
  if (!sp.get('p') && (target === '/' || target === '/index.html' || target === '/manga_reader.html')) {
    return serveFrontend(res);
  }

  /* --- 书源规则接口 --- */
  if (target === '/api/source/rules') return serveRules(res);

  /* --- 图片资源：备用 CDN 规则 + 解密 --- */
  if (BOOK_SOURCES.imageRule.match.test(target)) {
    return serveImage(target, req, res);
  }

  /* --- 数据：按书源规则转发 --- */
  for (let i = 0; i < ALLOWED_DATA.length; i++) {
    if (ALLOWED_DATA[i].test(target)) return serveData(target, query, req, res);
  }

  /* --- 未命中任何规则 --- */
  setCors(res);
  return res.status(404).json({
    error: 'no rule matched',
    target: target,
    hint: '仅放行书源规则表内的路径，见 /api/proxy?p=/api/source/rules',
    source: BOOK_SOURCES.name
  });
};
