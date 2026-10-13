/**
 * A/B 测试：精确定位 18comic API 的真实门槛
 * 
 * 关键发现：上一轮测试中两个 TLS 库都加载失败，
 * 但 plain https.get 却返回 200 + 真实数据。
 * 
 * 本测试对比四种组合，定位真正的门槛：
 * 1. 完整（token + Chrome UA）
 * 2. 无 token（只有 Chrome UA）
 * 3. 无 UA（只有 token）
 * 4. 全裸（无 token 无 UA）
 * 5. 完整重试（验证可复现性）
 */
const crypto = require('crypto');
const https = require('https');

const APP_TOKEN_SECRET = '185Hcomic3PAPP7R';
const APP_VERSION = '2.1.11';
const DOMAIN = 'www.cdnhjk.net';
const PATH = '/categories/filter?page=1&order=&c=all&o=mv';
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

function md5(s) {
  return crypto.createHash('md5').update(s, 'utf8').digest('hex');
}

function probe(label, opts) {
  const { useToken = true, useUA = true, ua = null } = opts || {};
  return new Promise((resolve) => {
    const ts = Math.floor(Date.now() / 1000).toString();
    const headers = { 'Accept-Encoding': 'identity' };
    if (useUA) headers['user-agent'] = ua || CHROME_UA;
    if (useToken) {
      headers['token'] = md5(ts + APP_TOKEN_SECRET);
      headers['tokenparam'] = ts + ',' + APP_VERSION;
    }
    const t0 = Date.now();
    let settled = false;
    const done = (o) => { if (!settled) { settled = true; resolve(o); } };
    const req = https.get({
      hostname: DOMAIN, port: 443, path: PATH, headers,
      timeout: 15000, rejectUnauthorized: false
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        let verdict = 'unknown';
        if (body.startsWith('{"code":200,"data"')) verdict = 'SUCCESS(encrypted)';
        else if (body.includes('Not legal')) verdict = 'REJECTED(not legal)';
        else if (body.includes('Just a moment') || body.includes('cf-mitigated')) verdict = 'CF_CHALLENGE';
        else if (body.startsWith('<')) verdict = 'HTML';
        done({
          label, status: res.statusCode, ms: Date.now() - t0,
          len: body.length, verdict, preview: body.substring(0, 160)
        });
      });
    });
    req.on('error', e => done({ label, error: e.message, ms: Date.now() - t0 }));
    req.on('timeout', () => { req.destroy(); done({ label, error: 'timeout', ms: Date.now() - t0 }); });
  });
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const sp = url.searchParams;
  const domain = sp.get('domain') || DOMAIN;

  const results = [];
  results.push(await probe('1. token + Chrome UA', { useToken: true, useUA: true }));
  results.push(await probe('2. 无 token + Chrome UA', { useToken: false, useUA: true }));
  results.push(await probe('3. token + 无 UA', { useToken: true, useUA: false }));
  results.push(await probe('4. 全裸（无 token 无 UA）', { useToken: false, useUA: false }));
  results.push(await probe('5. token + Chrome UA（重试）', { useToken: true, useUA: true }));
  results.push(await probe('6. token + Node 默认 UA', {
    useToken: true, useUA: true, ua: `node/${process.version}`
  }));

  const summary = {
    node_version: process.version,
    region: process.env.VERCEL_REGION || 'unknown',
    domain,
    path: PATH,
    probes: results,
    conclusion: {
      success_count: results.filter(r => r.verdict === 'SUCCESS(encrypted)').length,
      tls_fingerprint_needed: results.some(r => r.verdict === 'REJECTED(not legal)') === false
    }
  };

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  res.status(200).json(summary);
};
