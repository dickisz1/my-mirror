/**
 * 聚焦测试：/chapter 的 images 数组格式 + scramble_id HTML 提取
 */
const crypto = require('crypto');
const https = require('https');

const APP_TOKEN_SECRET = '185Hcomic3PAPP7R';
const APP_DATA_SECRET = '185Hcomic3PAPP7R';
const APP_VERSION = '2.1.11';
const DOMAIN = 'www.cdnhjk.net';

function md5(s) { return crypto.createHash('md5').update(s, 'utf8').digest('hex'); }

function apiGet(path, timeout = 15000) {
  return new Promise((resolve) => {
    const ts = Math.floor(Date.now() / 1000).toString();
    const headers = {
      'Accept-Encoding': 'identity',
      'user-agent': 'Mozilla/5.0 (Linux; Android 9) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.114 Safari/537.36',
      'token': md5(ts + APP_TOKEN_SECRET),
      'tokenparam': ts + ',' + APP_VERSION
    };
    let settled = false;
    const done = o => { if (!settled) { settled = true; resolve(o); } };
    const req = https.get({ hostname: DOMAIN, port: 443, path, headers, timeout, rejectUnauthorized: false }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => done({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8'), ts }));
    });
    req.on('error', e => done({ error: e.message, ts }));
    req.on('timeout', () => { req.destroy(); done({ error: 'timeout', ts }); });
  });
}

function dec(b64, ts) {
  const key = Buffer.from(md5(ts + APP_DATA_SECRET), 'utf8');
  const d = crypto.createDecipheriv('aes-256-ecb', key, null);
  d.setAutoPadding(true);
  return Buffer.concat([d.update(Buffer.from(b64, 'base64')), d.final()]).toString('utf8');
}

async function getDecrypted(path) {
  const r = await apiGet(path);
  if (r.error) return { error: r.error, status: r.status };
  let j;
  try { j = JSON.parse(r.body); } catch (e) { return { status: r.status, nonJson: r.body.substring(0, 400) }; }
  if (typeof j.data === 'string' && j.data) {
    try { j.data = JSON.parse(dec(j.data, r.ts)); } catch (e) { j.data = dec(j.data, r.ts); }
  }
  return { status: r.status, code: j.code, data: j.data, errorMsg: j.errorMsg };
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const sp = url.searchParams;
  const pid = sp.get('pid') || '146418';

  const out = { node: process.version, domain: DOMAIN, photo_id: pid, steps: {} };

  // 1. /chapter?id= 看 images 数组
  const chap = await getDecrypted(`/chapter?id=${pid}`);
  out.steps.chapter = { status: chap.status, code: chap.code, errorMsg: chap.errorMsg };
  if (chap.data) {
    out.steps.chapter.keys = Object.keys(chap.data);
    out.steps.chapter.name = chap.data.name;
    out.steps.chapter.id = chap.data.id;
    out.steps.chapter.series_id = chap.data.series_id;
    const imgs = chap.data.images;
    out.steps.chapter.images_type = Array.isArray(imgs) ? 'array' : typeof imgs;
    out.steps.chapter.images_count = Array.isArray(imgs) ? imgs.length : null;
    out.steps.chapter.images_sample = Array.isArray(imgs) ? imgs.slice(0, 3) : imgs;
    // 看是否有 scramble 字段
    ['scramble_id', 'scrambleId', 'scramble'].forEach(k => {
      if (chap.data[k] !== undefined) out.steps.chapter[k] = chap.data[k];
    });
  }

  // 2. /chapter_view_template 的 HTML（含 scramble_id）
  const ts = Math.floor(Date.now() / 1000);
  const scr = await apiGet(`/chapter_view_template?id=${pid}&mode=vertical&page=0&app_img_shunt=1&express=off&v=${ts}`);
  out.steps.scramble_template = { status: scr.status, len: scr.body ? scr.body.length : 0 };
  if (scr.body) {
    // 常见正则
    const pats = [
      /var\s+scramble_id\s*=\s*(\d+)/,
      /scramble_id\s*[=:]\s*["']?(\d+)/,
      /"scramble_id"\s*:\s*"?(\d+)"?/,
      /id\s*=\s*(\d{6})/,
    ];
    out.steps.scramble_template.matches = {};
    pats.forEach((p, i) => {
      const m = scr.body.match(p);
      out.steps.scramble_template.matches[`p${i}`] = m ? m[1] : null;
    });
    out.steps.scramble_template.body_head = scr.body.substring(0, 1500);
  }

  // 3. 对照：/album?id= 的 images 字段
  const alb = await getDecrypted(`/album?id=${pid}`);
  if (alb.data) {
    out.steps.album = {
      keys: Object.keys(alb.data),
      images_type: Array.isArray(alb.data.images) ? 'array' : typeof alb.data.images,
      images_count: Array.isArray(alb.data.images) ? alb.data.images.length : null,
      images_sample: Array.isArray(alb.data.images) ? alb.data.images.slice(0, 3) : alb.data.images,
      series_count: Array.isArray(alb.data.series) ? alb.data.series.length : null
    };
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(200).json(out);
};
