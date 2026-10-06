/**
 * api/proxy.js —— 漫画「书源代理」（多书源版）
 * ============================================================
 * 架构：
 *   第一步  请求被"截胡"      → vercel.json 把 /(.*) 全量转给本文件
 *   第二步  先返回前端界面    → 命中 / 时返回 manga_reader.html
 *   第三步  按书源规则取数据  → 本文件持有 SOURCES 源注册表，
 *                              按 ?src=<key> 选定源，转发到该源的 baseUrl；
 *                              图片按该源 imageRule 取（容灾 + 解密可选）
 *   第四步  浏览器渲染        → 前端拿到 JSON / 图片自行渲染
 *
 * 路由形态（显式携带目标路径 + 源 key）：
 *   /api/proxy?p=/api/home&page=1&pageSize=12&type=0&flag=1&src=manwaxu
 *   /api/proxy?p=/api/comic/94789&src=manwaxu
 *   /api/proxy?p=/en_images/20255/94789/1361313/0.jpg&src=manwaxu
 *   /api/proxy?p=/img-original/img/2024/10/05/16/05/08/123053801_p0.jpg&src=pixiv
 *   /api/proxy?p=/api/source/rules&src=pixiv
 *   /api/proxy?p=/api/sources
 *
 * **兼容契约**：不带 `src` 时一律使用 DEFAULT_SOURCE，
 * 且默认源的 rules 未声明 adapt/vars/multi 时走与旧版完全相同的直通路径。
 * ============================================================
 */
'use strict';

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/* ============================================================
 * 一、书源注册表
 * 新增源 = 在此加一项；前端通过 /api/sources 拿列表，
 * 通过 /api/source/rules?src=<key> 拿该源完整规则。
 * ============================================================ */

const SOURCES = {
  /* ---------------- 源 1：漫蛙漫画（AES 加密图 + CDN 容灾） ---------------- */
  manwaxu: {
    key: 'manwaxu',
    name: '漫蛙漫画',
    version: '2.0.0',
    baseUrl: 'https://manwaxu.cc',
    referer: 'https://manwaxu.cc/',
    timeout: 12000,
    userAgent: UA,

    /* 备用 CDN：依次重试，第一个成功即返回 */
    imageCdn: [
      'https://tu.mhttu.cc',
      'https://mwtuwu.cc',
      'https://tu.mwzu.cc',
      'https://mwtusi.cc'
    ],

    /* 图片解密（实测：前16字节=IV，其余=AES-256-CBC密文，PKCS#7） */
    decrypt: {
      enabled: true,
      algo: 'aes-256-cbc',
      key: '0B6666A0-BB59-1381-B746-a0E4C9AC',
      keyBytes: 32,
      ivBytes: 16
    },

    /* 取数规则：match 匹配前端请求路径；path 是上游路径模板 */
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
        match: /^\/api\/comic\/(\d+)$/,
        vars: { id: 1 }
      },
      chapters: {
        desc: '章节列表',
        path: '/api/comic/{id}/chapters',
        params: [],
        match: /^\/api\/comic\/(\d+)\/chapters$/,
        vars: { id: 1 }
      },
      chapInfo: {
        desc: '章节信息',
        path: '/api/comic/chapter/info/{cid}',
        params: [],
        match: /^\/api\/comic\/chapter\/info\/(\d+)$/,
        vars: { cid: 1 }
      },
      images: {
        desc: '图片列表',
        path: '/api/comic/image/{cid}',
        params: ['page', 'page_size', 'image_source'],
        match: /^\/api\/comic\/image\/(\d+)$/,
        vars: { cid: 1 }
      },
      announce: {
        desc: '公告',
        path: '/api/announcements',
        params: [],
        match: /^\/api\/announcements$/
      }
    },

    /* 首页栏目（前端按此渲染） */
    homeSections: [
      { grid: 'popularGrid',  title: '🔥 热门推荐', key: 'comicList' },
      { grid: 'latestGrid',   title: '🆕 最新更新', key: 'gufengList' },
      { grid: 'vipGrid',      title: '⭐ VIP专区',  key: 'vipList' },
      { grid: 'gufengGrid',   title: '🌙 古风',     key: 'gufengList' },
      { grid: 'xuanhuanGrid', title: '⚔ 玄幻',      key: 'xuanhuanList' },
      { grid: 'xiaoyuanGrid', title: '🎒 校园',     key: 'xiaoyuanList' }
    ],

    /* 图片资源规则 */
    imageRule: {
      desc: '图片资源',
      match: /^\/en_images\//,
      cdn: true,
      decrypt: true
    }
  },

  /* ---------------- 源 2：pixiv（明文图 + 防盗链 Referer，免登录） ---------------- */
  pixiv: {
    key: 'pixiv',
    name: 'pixiv',
    version: '1.0.0',
    baseUrl: 'https://www.pixiv.net',
    referer: 'https://www.pixiv.net/',
    timeout: 12000,
    userAgent: UA,

    imageCdn: [],                  // 固定单 host，无容灾链
    decrypt: { enabled: false },   // 明文图，不解密

    rules: {
      /* 首页 = 三张榜单（一次前端请求 → 三个上游请求组装） */
      home: {
        desc: '排行榜',
        frontPath: '/api/home',      // 前端请求路径
        path: '/ranking.php',        // 上游路径（与前端不同！）
        params: ['mode', 'format', 'p', 'content'],
        match: /^\/api\/home$/,
        multi: [
          { key: 'daily',   params: { mode: 'daily',   format: 'json', p: 1, content: 'all' } },
          { key: 'weekly',  params: { mode: 'weekly',  format: 'json', p: 1, content: 'all' } },
          { key: 'monthly', params: { mode: 'monthly', format: 'json', p: 1, content: 'all' } }
        ]
      },
      /* 搜索词在**路径段**里，不在 query */
      search: {
        desc: '搜索',
        frontPath: '/api/search',
        path: '/ajax/search/artworks/{keyword}',
        params: ['order', 'mode', 'type', 's_mode'],
        match: /^\/api\/search$/,
        vars: { keyword: 'query:keyword' },
        paramMap: { keyword: 'word', page: 'p' },
        paramDefaults: { order: 'date_d', mode: 'all', type: 'all', s_mode: 's_tag' }
      },
      detail: {
        desc: '作品详情',
        frontPath: '/api/comic/',
        path: '/ajax/illust/{id}',
        params: [],
        match: /^\/api\/comic\/(\d+)$/,
        vars: { id: 1 }
      },
      /* pixiv 无章节：合成单话（哨兵路径，由 serveData 的 fakeChapters 分支处理） */
      chapters: {
        desc: '章节（合成单话）',
        frontPath: '/api/comic/',
        path: '__fake_chapters__',
        params: [],
        match: /^\/api\/comic\/(\d+)\/chapters$/,
        vars: { id: 1 }
      },
      chapInfo: {
        desc: '章节信息',
        frontPath: '/api/comic/chapter/info/',
        path: '/ajax/illust/{cid}',
        params: [],
        match: /^\/api\/comic\/chapter\/info\/(\d+)$/,
        vars: { cid: 1 }
      },
      images: {
        desc: '图片列表',
        frontPath: '/api/comic/image/',
        path: '/ajax/illust/{cid}/pages',
        params: [],
        match: /^\/api\/comic\/image\/(\d+)$/,
        vars: { cid: 1 }
      },
      announce: {
        desc: '公告',
        frontPath: '/api/announcements',
        path: '/ajax/announcements',
        params: [],
        match: /^\/api\/announcements$/
      }
    },

    /* 字段归一化声明：把 pixiv 响应转成前端认的结构（前端零改动） */
    adapt: {
      listPath: 'contents',                     // /ranking.php
      searchListPath: 'body.illustManga.data',  // /ajax/search
      detailPath: 'body',                       // /ajax/illust/{id}
      imagesPath: 'body',                       // /ajax/illust/{id}/pages
      totalPath: 'rank_total',
      field: {
        id: 'illust_id',
        title: 'title',
        pic: 'url',
        author: 'user_name',
        tags: 'tags',
        hits: 'view_count'
      },
      tagsJoin: true,       // tags 数组 → 逗号串
      filterMasked: true,   // 过滤 is_masked（无 cookie 取图必失败）
      fakeChapters: true,   // 无章节源 → 合成单话
      /* 搜索端点的字段名与 ranking 不同（实测）：
         search 用 id/userName/tags[]，ranking 用 illust_id/user_name/view_count */
      searchField: {
        id: 'id',
        title: 'title',
        pic: 'url',
        author: 'userName',
        tags: 'tags'
      }
    },

    homeSections: [
      { grid: 'popularGrid', title: '🏆 日榜', key: 'daily' },
      { grid: 'latestGrid',  title: '📅 周榜', key: 'weekly' },
      { grid: 'vipGrid',     title: '🗓 月榜', key: 'monthly' }
    ],

    imageRule: {
      desc: 'pixiv 图片',
      match: /^\/(img-master|img-original|c|user-profile)\//,
      cdn: false,
      decrypt: false,
      host: 'https://i.pximg.net'
    }
  },

  /* ---------------- 源 3：18comic（CF 挑战 + 图片切片还原，经 helper） ---------------- */
  comic18: {
    key: 'comic18',
    name: '18comic',
    version: '1.0.0',
    baseUrl: 'https://18comic.vip',
    referer: 'https://18comic.vip/',
    timeout: 30000,                 // 首次抓取需过盾 ~30s
    userAgent: UA,
    imageCdn: [],
    decrypt: { enabled: false },    // 切片还原在 helper 里做，不是加密

    /* 关键：整源走 helper 转发（见 handler 的 helper 分支）。
       path 是 helper 的相对路径，params 是 helper 的参数名。 */
    viaHelper: true,

    rules: {
      home: {
        desc: '列表',
        frontPath: '/api/home',
        path: '/list',
        params: ['path'],
        paramDefaults: { path: '/albums' },
        match: /^\/api\/home$/
      },
      search: {
        desc: '搜索',
        frontPath: '/api/search',
        path: '/search',
        params: ['keyword'],
        match: /^\/api\/search$/
      },
      detail: {
        desc: '作品详情',
        frontPath: '/api/comic/',
        path: '/detail',
        params: ['id'],
        match: /^\/api\/comic\/(\d+)$/,
        vars: { id: 1 }
      },
      chapters: {
        desc: '章节列表',
        frontPath: '/api/comic/',
        path: '/chapters',
        params: ['id'],
        match: /^\/api\/comic\/(\d+)\/chapters$/,
        vars: { id: 1 }
      },
      chapInfo: {
        desc: '章节信息',
        frontPath: '/api/comic/chapter/info/',
        path: '/detail',
        params: ['id'],
        match: /^\/api\/comic\/chapter\/info\/(\d+)$/,
        vars: { id: 1 }
      },
      images: {
        desc: '图片列表',
        frontPath: '/api/comic/image/',
        path: '/images',
        params: ['cid'],
        match: /^\/api\/comic\/image\/(\d+)$/,
        vars: { cid: 1 }
      },
      announce: {
        desc: '公告',
        frontPath: '/api/announcements',
        path: '/list',
        params: ['path'],
        paramDefaults: { path: '/albums' },
        match: /^\/api\/announcements$/
      }
    },

    homeSections: [
      { grid: 'popularGrid',  title: '🔥 最新', key: 'comicList' },
      { grid: 'latestGrid',   title: '📚 同人', key: 'doujinList' },
      { grid: 'vipGrid',      title: '📖 单本', key: 'singleList' },
      { grid: 'gufengGrid',   title: '🇰🇷 韩漫', key: 'hanmanList' },
      { grid: 'xuanhuanGrid', title: '🦸 美漫', key: 'meimanList' },
      { grid: 'xiaoyuanGrid', title: '📏 短篇', key: 'shortList' }
    ],

    /* 首页多栏目：一次前端请求 → 多次 helper 调用。
       路径必须是真实存在的分类（实测从首页 HTML 里取到的）。
       注意：浏览器会话是串行的，6 个栏目会累加 2-4 分钟（实测 200s 仍有
       一个超时）。所以这里只放 2 个（首屏够用），其余靠用户点分类页加载。 */
    homeMulti: [
      { key: 'comicList',  path: '/albums' },
      { key: 'doujinList', path: '/albums/doujin' }
    ],

    /* 图片：helper 的 /img 端点（取回 + 切片还原） */
    imageRule: {
      desc: '18comic 图片',
      match: /^\/media\//,
      cdn: false,
      decrypt: false,
      helper: true                  // 走 helper 的 /img
    }
  }
};

const DEFAULT_SOURCE = 'manwaxu';

/* 18comic 的数据/图片都要过 Cloudflare 挑战 + 图片切片还原，这两件事
   Vercel 的 Node 函数做不到（需要真 Chrome 指纹），所以由一个 helper 进程承担。
   本地验证时 helper 在 127.0.0.1；搬到墙外 VPS 后只需改这一个环境变量。
   —— A 方案（本地）→ B 方案（VPS）的切换点就是这里。 */
const HELPER_URL = (process.env.COMIC_HELPER || 'http://127.0.0.1:8765').replace(/\/+$/, '');

/** 解析源 key；未知/缺省一律回落默认源（保证旧链接与旧缓存可用） */
function resolveSource(key) {
  if (key && Object.prototype.hasOwnProperty.call(SOURCES, key)) return SOURCES[key];
  return SOURCES[DEFAULT_SOURCE];
}

/** 源列表（只暴露展示所需字段，不含密钥 / rules / userAgent） */
function sourceList() {
  return Object.keys(SOURCES).map(k => {
    const s = SOURCES[k];
    return { key: s.key, name: s.name, version: s.version, baseUrl: s.baseUrl };
  });
}

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

/** 按源的解密规则处理图片；明文图片原样返回 */
function decryptImage(src, buf) {
  const plainMime = sniffMime(buf);
  if (plainMime) return { body: buf, mime: plainMime, decrypted: false };

  const rule = src.decrypt || {};
  if (!rule.enabled) return { body: buf, mime: 'application/octet-stream', decrypted: false };

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
function upstreamHeaders(src, req) {
  return {
    Referer: src.referer,
    Origin: src.baseUrl,
    'User-Agent': (req.headers && req.headers['user-agent']) || src.userAgent,
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
 * 三、路径模板 / 字段归一化
 * ============================================================ */

/** 按 a.b.c 取嵌套字段 */
function getByPath(obj, p) {
  if (!obj || !p) return undefined;
  const parts = String(p).split('.');
  let cur = obj;
  for (let i = 0; i < parts.length; i++) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[parts[i]];
  }
  return cur;
}

/** 填路径占位符：{id} {cid} {keyword} 等（值做 URL 编码） */
function fillPath(tpl, vars) {
  return String(tpl).replace(/\{(\w+)\}/g, (m, k) => {
    const v = vars ? vars[k] : undefined;
    return (v === undefined || v === null || v === '') ? m : encodeURIComponent(v);
  });
}

/** 从「前端请求路径 + query」抽出路径变量 */
function extractVars(rule, target, query) {
  const vars = {};
  if (!rule || !rule.vars) return vars;
  const m = rule.match ? String(target).match(rule.match) : null;
  Object.keys(rule.vars).forEach(name => {
    const spec = rule.vars[name];
    if (typeof spec === 'number') {
      if (m && m[spec] !== undefined) vars[name] = m[spec];        // 正则捕获组
    } else if (typeof spec === 'string' && spec.indexOf('query:') === 0) {
      const v = query.get(spec.slice(6));                          // 从 query 取
      if (v !== null && v !== '') vars[name] = v;
    }
  });
  return vars;
}

/** 构造上游 query（白名单参数 + 改名映射 + 默认值） */
function buildUpstreamQuery(rule, query, extraParams) {
  const out = new URLSearchParams();
  const allow = rule.params || [];
  const defaults = rule.paramDefaults || {};
  const map = rule.paramMap || {};        // 前端参数名 → 上游参数名

  /* 1) 白名单参数（按上游名直接取） */
  allow.forEach(name => {
    const v = query.get(name);
    if (v !== null) out.set(name, v);
    else if (defaults[name] !== undefined) out.set(name, defaults[name]);
  });

  /* 2) 改名映射（如 page→p、keyword→word） */
  Object.keys(map).forEach(fk => {
    const up = map[fk];
    const v = query.get(fk);
    if (v !== null && v !== '') out.set(up, v);
    else if (defaults[up] !== undefined && !out.has(up)) out.set(up, defaults[up]);
  });

  if (extraParams) {
    Object.keys(extraParams).forEach(k => out.set(k, extraParams[k]));
  }
  return out.toString();
}

/** 归一化单个列表项 → 前端认的结构
 *  fieldOverride：某些源的列表端点字段名不同（如 pixiv 的 /ranking.php 用
 *  illust_id/user_name，而 /ajax/search 用 id/userName），故按端点覆盖映射。 */
function mapItem(src, raw, fieldOverride) {
  const ad = src.adapt;
  if (!ad) return raw;
  const f = fieldOverride || ad.field || {};
  const pick = k => {
    const key = f[k];
    return key ? raw[key] : undefined;
  };

  let tags = pick('tags');
  if (Array.isArray(tags)) tags = tags.join(',');
  else if (typeof tags !== 'string') tags = '';

  const id = pick('id');
  return {
    id: id === undefined || id === null ? '' : String(id),
    title: pick('title') || '',
    pic: pick('pic') || '',
    author: pick('author') || '',
    tags: tags,
    tHits: Number(pick('hits')) || 0,
    collection: 0,
    status: 1,
    intro: ''
  };
}

/** 归一化列表响应 → {code:200, data:{list, comicList, total}} */
function normalizeList(src, raw, opts) {
  opts = opts || {};
  const ad = src.adapt;
  if (!ad) return raw;

  const arrPath = opts.listPath || ad.listPath;
  let arr = getByPath(raw, arrPath);
  if (!Array.isArray(arr)) arr = [];

  const field = opts.field || ad.field;
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const it = arr[i];
    if (ad.filterMasked && it && it.is_masked) continue;   // 需登录，取图必失败
    const mapped = mapItem(src, it, field);
    if (!mapped.id && !mapped.title && !mapped.pic) continue;   // 脏项（字段全取不到）
    out.push(mapped);
  }

  const total = Number(getByPath(raw, ad.totalPath)) || out.length;
  return { code: 200, data: { list: out, comicList: out, total: total } };
}

/** 归一化详情响应 */
function normalizeDetail(src, raw) {
  const ad = src.adapt;
  if (!ad) return raw;
  const body = getByPath(raw, ad.detailPath);
  if (!body || typeof body !== 'object') return raw;

  const urls = body.urls || {};
  let tags = body.tags;
  if (tags && Array.isArray(tags.tags)) tags = tags.tags.map(t => t && t.tag).filter(Boolean);
  else if (Array.isArray(tags)) tags = tags;
  else tags = [];

  const cover = urls.regular || urls.small || urls.original || '';
  return {
    code: 200,
    data: {
      id: String(body.id || body.illustId || ''),
      title: body.illustTitle || body.title || '',
      author: body.userName || '',
      cover: cover,
      pic: cover,
      tags: tags.join(','),
      intro: body.illustComment || body.description || '',
      tHits: Number(body.viewCount) || 0,
      collection: 0,
      status: 1,
      pageCount: Number(body.pageCount) || 0
    }
  };
}

/** 归一化图片列表响应 → {code:200, data:{images:[{url,urlOrig}]}} */
function normalizeImages(src, raw) {
  const ad = src.adapt;
  if (!ad) return raw;
  const body = getByPath(raw, ad.imagesPath);
  const arr = Array.isArray(body) ? body : [];
  const images = arr.map(x => {
    const u = (x && x.urls) || {};
    return { url: u.regular || u.original || u.small || '', urlOrig: u.original || u.regular || '' };
  }).filter(x => x.url);
  return { code: 200, data: { images: images } };
}

/* ============================================================
 * 四、处理器
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

/** 书源规则接口（保持返回**单个源对象**，含 rules —— 前端依赖 j.rules 判定成功） */
function serveRules(src, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.status(200).send(JSON.stringify(src));
}

/** 源列表接口（不含密钥 / rules / userAgent） */
function serveSources(res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res
    .status(200)
    .send(JSON.stringify({ code: 200, data: sourceList(), default: DEFAULT_SOURCE }));
}

/** 走 helper 的数据请求（18comic：需过 CF 挑战） */
async function serveDataViaHelper(src, action, rule, target, query, req, res) {
  const vars = extractVars(rule, target, query);
  /* helper 首次抓取要过盾 ~30s；首页要连抓 6 个栏目，
     所以给 helper 的请求单独的、宽松的超时（与源的 timeout 分开）。 */
  const HELPER_TIMEOUT = Number(process.env.COMIC_HELPER_TIMEOUT || 240000);

  /* 首页多栏目：一次前端请求 → 多次 helper 调用。
     并发发（helper 内部有锁会串行化，但连接建立可并行），
     整体用 Promise.all 汇总，避免串行累加超时。 */
  if (action === 'home' && src.homeMulti && src.homeMulti.length) {
    try {
      const results = await Promise.all(src.homeMulti.map(async m => {
        const up = HELPER_URL + '/list?path=' + encodeURIComponent(m.path);
        try {
          const r = await fetchRaw(up, { Accept: '*/*' }, HELPER_TIMEOUT);
          /* helper 可能"响应了但报错"（返回 502 + JSON error）。
             fetchRaw 只对网络错误抛异常，所以必须显式检查状态码，
             否则 JSON.parse 成功但 j.data 为空 → 又变成静默空列表。 */
          if (r.status !== 200) {
            let em = 'helper HTTP ' + r.status;
            try { const e = JSON.parse(r.body.toString('utf8')); if (e && (e.msg || e.error)) em = String(e.msg || e.error).slice(0, 140); } catch (_) {}
            return { key: m.key, path: m.path, ok: false, err: em, list: [] };
          }
          const j = JSON.parse(r.body.toString('utf8'));
          return { key: m.key, path: m.path, ok: true,
                   list: (j && j.data && (j.data.comicList || j.data.list)) || [] };
        } catch (e) {
          console.log('[proxy] helper list 失败 %s: %s', m.path, String(e.message).slice(0, 80));
          return { key: m.key, path: m.path, ok: false,
                   err: String(e.message).slice(0, 160), list: [] };
        }
      }));
      const failed = results.filter(r => !r.ok);
      const data = {};
      results.forEach(r => { data[r.key] = r.list; });

      /* helper 完全不可达 → 明确报错。绝不返回"静默空列表"：
         那样前端只是显示空白，看不出是 helper 没起，最难排查。 */
      if (failed.length === results.length) {
        setCors(res);
        return res.status(502).json({
          code: 502,
          error: 'helper 不可达',
          helper: HELPER_URL,
          source: src.name,
          failed: failed.map(f => ({ path: f.path, err: f.err })),
          hint: '18comic 源需要 helper 进程（过 Cloudflare + 图片切片还原）在 ' + HELPER_URL +
                ' 运行；线上需把环境变量 COMIC_HELPER 指向墙外 VPS。'
        });
      }

      /* 部分失败 → 200，但带 _helper 标记，前端可据此提示"部分栏目加载失败" */
      data._helper = { ok: failed.length === 0, helper: HELPER_URL };
      if (failed.length) {
        data._helper.failed = failed.map(f => ({ path: f.path, err: f.err }));
      }

      setCors(res);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      if (failed.length) res.setHeader('X-Helper-Partial', '1');
      return res.status(200).send(JSON.stringify({ code: 200, data: data }));
    } catch (err) {
      setCors(res);
      return res.status(502).json({ error: err.message, rule: 'helper(homeMulti)',
                                    source: src.name, helper: HELPER_URL });
    }
  }

  /* helper 的参数来源有两处：
     1) rule.params 里声明的（从 query 读，如 search 的 keyword）
     2) rule.vars 从**路径**提取的（如 /api/comic/123 → id=123）
     前端把 id 放在路径里，不是 query，所以必须把 vars 也带过去。 */
  const q = buildUpstreamQuery(rule, query, vars);
  const up = HELPER_URL + fillPath(rule.path, vars) + (q ? '?' + q : '');
  try {
    const r = await fetchRaw(up, { Accept: '*/*' }, HELPER_TIMEOUT);
    setCors(res);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(r.status).send(r.body);
  } catch (err) {
    setCors(res);
    return res.status(502).json({
      error: err.message, rule: action, target: up, source: src.name,
      hint: '18comic 需要 helper 进程（过 Cloudflare + 图片切片还原）在 ' + HELPER_URL + ' 运行'
    });
  }
}

/** 走 helper 的图片（18comic：取回 + 切片还原） */
async function serveImageViaHelper(src, target, req, res) {
  /* target 形如 /media/photos/{book}/{img}.webp
     还原需要 book 与 img 两个值来算段数，都从路径里取。 */
  const m = String(target).match(/^\/media\/(?:photos|albums|videos)\/(?:tmb\/)?(\d+)\/([^/?#]+)/);
  let book = '', img = '';
  if (m) {
    book = m[1];
    img = (m[2] || '').replace(/\.[a-z0-9]+$/i, '');
  }
  const up = HELPER_URL + '/img?url=' + encodeURIComponent(src.baseUrl + target) +
             '&book=' + encodeURIComponent(book) + '&img=' + encodeURIComponent(img);
  try {
    const r = await fetchRaw(up, { Accept: '*/*' }, src.timeout);
    if (r.status === 200 && r.body && r.body.length > 0) {
      setCors(res);
      res.setHeader('Content-Type', r.headers['content-type'] || 'image/webp');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('X-Source-Rule', 'image(helper)');
      if (r.headers['x-cache']) res.setHeader('X-Helper-Cache', r.headers['x-cache']);
      return res.status(200).send(r.body);
    }
    setCors(res);
    return res.status(502).json({ error: 'helper image status ' + r.status, target: target });
  } catch (err) {
    setCors(res);
    return res.status(502).json({
      error: err.message, rule: 'image(helper)', target: target,
      hint: 'helper 未运行？' + HELPER_URL
    });
  }
}

/** 第三步-A：按书源规则取数据 */
async function serveData(src, action, rule, target, query, req, res) {
  /* 整源走 helper 的源（18comic） */
  if (src.viaHelper) return serveDataViaHelper(src, action, rule, target, query, req, res);

  const vars = extractVars(rule, target, query);

  /* ---- 合成章节（无章节源，如 pixiv）：先取详情拿 pageCount ---- */
  if (rule.path === '__fake_chapters__') {
    try {
      const dRule = src.rules.detail;
      const dPath = fillPath(dRule.path, { id: vars.id });
      const dQuery = buildUpstreamQuery(dRule, query, null);
      const upstream = src.baseUrl + dPath + (dQuery ? '?' + dQuery : '');
      const r = await fetchRaw(upstream, upstreamHeaders(src, req), src.timeout);
      const j = JSON.parse(r.body.toString('utf8'));
      const det = normalizeDetail(src, j);
      const d = (det && det.data) || {};
      setCors(res);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).send(JSON.stringify({
        code: 200,
        data: {
          list: [{
            id: String(d.id || vars.id || ''),
            title: d.title || '本作品',
            sortId: 1,
            picCount: Number(d.pageCount) || 0,
            isVip: false
          }]
        }
      }));
    } catch (err) {
      setCors(res);
      return res.status(502).json({ error: err.message, rule: 'chapters(fake)', source: src.name });
    }
  }

  /* ---- 多请求组装（如 pixiv 首页三张榜单） ---- */
  if (rule.multi && rule.multi.length) {
    try {
      const data = {};
      for (let i = 0; i < rule.multi.length; i++) {
        const m = rule.multi[i];
        const q = buildUpstreamQuery(rule, query, m.params);
        const upstream = src.baseUrl + rule.path + (q ? '?' + q : '');
        const r = await fetchRaw(upstream, upstreamHeaders(src, req), src.timeout);
        let j = null;
        try { j = JSON.parse(r.body.toString('utf8')); } catch (e) { j = null; }
        const norm = normalizeList(src, j, null);
        data[m.key] = (norm && norm.data && norm.data.comicList) || [];
      }
      setCors(res);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).send(JSON.stringify({ code: 200, data: data }));
    } catch (err) {
      setCors(res);
      return res.status(502).json({ error: err.message, rule: 'data(multi)', source: src.name });
    }
  }

  /* ---- 单请求 ---- */
  const upPath = fillPath(rule.path, vars);
  const q = buildUpstreamQuery(rule, query, null);
  const upstream = src.baseUrl + upPath + (q ? '?' + q : '');

  try {
    const r = await fetchRaw(upstream, upstreamHeaders(src, req), src.timeout);

    /* 无 adapt 声明的源 → 完全直通（与旧版行为一致） */
    if (!src.adapt) {
      setCors(res);
      res.setHeader('Content-Type', r.headers['content-type'] || 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(r.status).send(r.body);
    }

    /* 有 adapt 声明 → 归一化 */
    const raw = r.body.toString('utf8');
    let out = raw;
    let j = null;
    try { j = JSON.parse(raw); } catch (e) { j = null; }
    if (j) {
      let norm = null;
      if (action === 'detail' || action === 'chapInfo') norm = normalizeDetail(src, j);
      else if (action === 'images') norm = normalizeImages(src, j);
      else if (action === 'search') norm = normalizeList(src, j, { listPath: src.adapt.searchListPath, field: src.adapt.searchField });
      else if (action === 'home') norm = normalizeList(src, j, null);
      if (norm) out = JSON.stringify(norm);
    }

    setCors(res);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(r.status).send(out);
  } catch (err) {
    setCors(res);
    return res.status(502).json({
      error: err.message,
      rule: action,
      target: upstream,
      source: src.name
    });
  }
}

/** 第三步-B：按源的图片规则取图（容灾 + 可选解密） */
async function serveImage(src, target, req, res) {
  const ir = src.imageRule || {};

  /* 走 helper 的图片（18comic：切片还原） */
  if (ir.helper) return serveImageViaHelper(src, target, req, res);

  const hosts = ir.host ? [ir.host] : (src.imageCdn || []);
  const tried = [];
  let lastErr = null;

  for (let i = 0; i < hosts.length; i++) {
    const base = hosts[i].replace(/\/+$/, '');
    const upstream = base + target;
    try {
      const r = await fetchRaw(upstream, upstreamHeaders(src, req), src.timeout);
      if (r.status === 200 && r.body && r.body.length > 0) {
        const dec = decryptImage(src, r.body);
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
    error: lastErr ? lastErr.message : 'all hosts failed',
    rule: 'image',
    target: target,
    tried: tried,
    source: src.name
  });
}

/* ============================================================
 * 五、入口
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

  // 选定源：不带 src 时回落默认源（旧链接 / 旧缓存继续可用）
  const src = resolveSource(sp.get('src'));

  // 显式目标优先，裸路径兜底
  let target = sp.get('p') || pathname;
  if (target.charAt(0) !== '/') target = '/' + target;

  // 转发时剔除内部参数（p 与 src 都不透传给上游）
  const rest = new URLSearchParams(sp);
  rest.delete('p');
  rest.delete('src');
  const query = rest;

  /* --- 第二步：先返回前端界面 --- */
  if (!sp.get('p') && (target === '/' || target === '/index.html' || target === '/manga_reader.html')) {
    return serveFrontend(res);
  }

  /* --- 书源规则 / 源列表接口 --- */
  if (target === '/api/source/rules') return serveRules(src, res);
  if (target === '/api/sources') return serveSources(res);

  /* --- 图片资源：按源的 imageRule 取图 --- */
  if (src.imageRule && src.imageRule.match && src.imageRule.match.test(target)) {
    return serveImage(src, target, req, res);
  }

  /* --- 数据：按源的规则表转发 --- */
  const actions = Object.keys(src.rules);
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const rule = src.rules[action];
    if (rule.match && rule.match.test(target)) {
      return serveData(src, action, rule, target, query, req, res);
    }
  }

  /* --- 未命中任何规则 --- */
  setCors(res);
  return res.status(404).json({
    error: 'no rule matched',
    target: target,
    source: src.name,
    hint: '仅放行书源规则表内的路径，见 /api/proxy?p=/api/source/rules&src=' + src.key
  });
};
