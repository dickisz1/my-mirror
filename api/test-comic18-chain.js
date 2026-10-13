/**
 * 端到端链路测试：18comic 移动端 API 真实路径
 *
 * 从 jmcomic JmApiClient 源码提取的真实路径：
 *   API_SEARCH           = '/search'
 *   API_CATEGORIES_FILTER= '/categories/filter'  params: page, order='', c, o
 *   API_ALBUM            = '/album'              params: id
 *   API_CHAPTER          = '/chapter'            params: id
 *   API_SCRAMBLE         = '/chapter_view_template' params: id, mode, page, app_img_shunt, express, v
 *   '/setting'
 *
 * 链路：categories/filter → album?id → chapter?id → chapter_view_template?id
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

function dec(b64, ts) {
  const key = Buffer.from(md5(ts + APP_DATA_SECRET), 'utf8');
  const d = crypto.createDecipheriv('aes-256-ecb', key, null);
  d.setAutoPadding(true);
  return Buffer.concat([d.update(Buffer.from(b64, 'base64')), d.final()]).toString('utf8');
}

async function callApi(label, path) {
  const r = await apiGet(path);
  const out = { label, path, status: r.status, ms: r.ms };
  if (r.error) { out.error = r.error; return out; }
  let j = null;
  try { j = JSON.parse(r.body); } catch (e) {}
  if (!j) { out.raw = r.body.substring(0, 300); return out; }
  out.code = j.code;
  out.errorMsg = j.errorMsg || undefined;
  if (typeof j.data === 'string' && j.data.length > 0) {
    try {
      const plain = dec(j.data, r.ts);
      out.decrypt = 'OK';
      try {
        const parsed = JSON.parse(plain);
        out.parsed = parsed;
        if (Array.isArray(parsed)) out.item_count = parsed.length;
        else if (parsed && typeof parsed === 'object') out.keys = Object.keys(parsed).slice(0, 30);
      } catch (e) {
        out.plain_head = plain.substring(0, 400);
      }
    } catch (e) { out.decrypt = 'ERR:' + e.message; }
  } else {
    out.data_empty = true;
    out.raw = r.body.substring(0, 300);
  }
  return out;
}

function brief(o, max = 1200) {
  const c = { ...o };
  if (c.parsed) {
    const s = JSON.stringify(c.parsed);
    c.parsed_preview = s.substring(0, max);
    delete c.parsed;
  }
  return c;
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const sp = url.searchParams;
  const aid = sp.get('aid') || '1114751';

  const results = [];

  // 1. setting
  results.push(brief(await callApi('setting', '/setting'), 600));

  // 2. 列表
  const list = await callApi('列表 categories/filter', '/categories/filter?page=1&order=&c=all&o=mv');
  const listBrief = brief(list, 400);
  results.push(listBrief);

  // 3. 专辑详情 /album?id=
  const album = await callApi('专辑详情 /album', `/album?id=${aid}`);
  results.push(brief(album, 1500));

  // 从专辑详情提取第一个 photo/chapter id
  let photoId = sp.get('pid') || null;
  if (!photoId && album.parsed) {
    const s = JSON.stringify(album.parsed);
    const m = s.match(/"(?:id|photo_id|chapter_id)"\s*:\s*"?(\d{5,})"?/);
    if (m) photoId = m[1];
    // series/episode 数组
    const arr = album.parsed.series || album.parsed.episode || album.parsed.chapters;
    if (!photoId && Array.isArray(arr) && arr.length) {
      const f = arr[0];
      photoId = String(f.id || f.photo_id || f.chapter_id || '');
    }
  }
  results.push({ derived_photo_id: photoId });

  if (photoId) {
    // 4. 章节详情 /chapter?id=
    const chap = await callApi('章节详情 /chapter', `/chapter?id=${photoId}`);
    results.push(brief(chap, 2000));

    // 5. scramble /chapter_view_template
    const ts = Math.floor(Date.now() / 1000);
    const scramble = await callApi('scramble /chapter_view_template',
      `/chapter_view_template?id=${photoId}&mode=vertical&page=0&app_img_shunt=1&express=off&v=${ts}`);
    results.push(brief(scramble, 1000));
  }

  // 6. 搜索 /search
  const search = await callApi('搜索 /search', '/search?main_tag=0&search_query=secret&page=1&o=mr&t=');
  results.push(brief(search, 600));

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(200).json({
    node: process.version,
    region: process.env.VERCEL_REGION || 'unknown',
    domain: DOMAIN,
    results
  });
};
