/**
 * 端到端探测：18comic API 真实路径 + AES 解密验证
 * 
 * 验证目标：
 * 1. AES 解密模式（ECB vs CBC）哪个正确
 * 2. 真实 API 路径：列表 / 搜索 / 详情 / 章节 / 图片
 * 3. 解密后的数据结构（字段名）
 */
const crypto = require('crypto');
const https = require('https');

const APP_TOKEN_SECRET = '185Hcomic3PAPP7R';
const APP_DATA_SECRET = '185Hcomic3PAPP7R';
const APP_VERSION = '2.1.11';
const DOMAIN = 'www.cdnhjk.net';

function md5(s) { return crypto.createHash('md5').update(s, 'utf8').digest('hex'); }

function get(path, timeout = 15000) {
  return new Promise((resolve) => {
    const ts = Math.floor(Date.now() / 1000).toString();
    const headers = {
      'Accept-Encoding': 'identity',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
      'token': md5(ts + APP_TOKEN_SECRET),
      'tokenparam': ts + ',' + APP_VERSION
    };
    const t0 = Date.now();
    let settled = false;
    const done = o => { if (!settled) { settled = true; resolve(o); } };
    const req = https.get({ hostname: DOMAIN, port: 443, path, headers, timeout, rejectUnauthorized: false }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => done({ status: res.statusCode, ms: Date.now() - t0, body: Buffer.concat(chunks).toString('utf8'), ts }));
    });
    req.on('error', e => done({ error: e.message, ms: Date.now() - t0, ts }));
    req.on('timeout', () => { req.destroy(); done({ error: 'timeout', ms: Date.now() - t0, ts }); });
  });
}

function decryptECB(b64, ts) {
  try {
    const key = Buffer.from(md5(ts + APP_DATA_SECRET), 'utf8');
    const d = crypto.createDecipheriv('aes-256-ecb', key, null);
    d.setAutoPadding(true);
    return Buffer.concat([d.update(Buffer.from(b64, 'base64')), d.final()]).toString('utf8');
  } catch (e) { return 'ECB_ERR:' + e.message; }
}

function decryptCBC(b64, ts) {
  try {
    const key = Buffer.from(md5(ts + APP_DATA_SECRET), 'utf8');
    const buf = Buffer.from(b64, 'base64');
    const iv = buf.subarray(0, 16);
    const data = buf.subarray(16);
    const d = crypto.createDecipheriv('aes-256-cbc', key, iv);
    d.setAutoPadding(true);
    return Buffer.concat([d.update(data), d.final()]).toString('utf8');
  } catch (e) { return 'CBC_ERR:' + e.message; }
}

function shape(obj, depth = 0) {
  if (depth > 2) return '...';
  if (Array.isArray(obj)) return obj.length ? [shape(obj[0], depth + 1)] : [];
  if (obj && typeof obj === 'object') {
    const o = {};
    Object.keys(obj).slice(0, 25).forEach(k => { o[k] = shape(obj[k], depth + 1); });
    return o;
  }
  if (typeof obj === 'string') return obj.length > 40 ? `str(${obj.length})` : obj;
  return obj;
}

async function probePath(label, path) {
  const r = await get(path);
  const out = { label, path, status: r.status, ms: r.ms };
  if (r.error) { out.error = r.error; return out; }
  let j = null;
  try { j = JSON.parse(r.body); } catch (e) {}
  if (!j) { out.raw = r.body.substring(0, 200); return out; }
  out.code = j.code;
  out.errorMsg = j.errorMsg || undefined;
  if (typeof j.data === 'string') {
    const ecb = decryptECB(j.data, r.ts);
    const cbc = decryptCBC(j.data, r.ts);
    out.ecb_ok = !ecb.startsWith('ECB_ERR');
    out.cbc_ok = !cbc.startsWith('CBC_ERR');
    let parsed = null, which = null;
    try { parsed = JSON.parse(ecb); which = 'ECB'; } catch (e) {}
    if (!parsed) { try { parsed = JSON.parse(cbc); which = 'CBC'; } catch (e) {} }
    out.decrypt_mode = which;
    if (parsed) {
      out.data_shape = shape(parsed);
      out.data_sample = JSON.stringify(parsed).substring(0, 900);
    } else {
      out.ecb_head = ecb.substring(0, 120);
      out.cbc_head = cbc.substring(0, 120);
    }
  } else {
    out.data_shape = shape(j.data);
    out.data_sample = JSON.stringify(j).substring(0, 900);
  }
  return out;
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const sp = url.searchParams;

  // 真实 API 路径候选
  const list = await probePath('列表 categories/filter', '/categories/filter?page=1&order=&c=all&o=mv');
  const results = [list];

  // 从列表结果提取一个 album id，用于后续探测
  let aid = sp.get('aid') || null;
  if (!aid && list.data_sample) {
    const m = list.data_sample.match(/"id"\s*:\s*"?(\d+)"?/);
    if (m) aid = m[1];
  }
  results[0].derived_aid = aid;

  if (aid) {
    results.push(await probePath('详情 album', `/album/${aid}`));
    results.push(await probePath('详情 comic_detail', `/comic_detail?id=${aid}`));
    results.push(await probePath('章节 chapters', `/chapter/get_album_chapter?album_id=${aid}`));
    results.push(await probePath('章节 chapter_list', `/chapter_list?album_id=${aid}`));
    results.push(await probePath('图片 get_photo_image', `/chapter/get_photo_image?photo_id=${aid}`));
    results.push(await probePath('图片 chapter_view_template', `/chapter_view_template?id=${aid}`));
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(200).json({
    node: process.version,
    region: process.env.VERCEL_REGION || 'unknown',
    domain: DOMAIN,
    results
  });
};
