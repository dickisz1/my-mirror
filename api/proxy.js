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
 * 运维开关（默认全关）
 * ------------------------------------------------------------
 * 两者都是历史遗留能力的开关，comic18 主链路已不使用：
 *   - 任务队列（/task /claim /status /callback）：上一代 worker 方案，
 *     /callback 无鉴权、可按 task_id 写入任意结果，默认关闭（返回 410）。
 *   - 调试端点（/api/debug/*）：会吐签名 token 与上游原始响应，默认 404。
 * 需要时在 Vercel 环境变量里显式打开，不要默认开启。
 * ============================================================ */
const TASK_QUEUE_ENABLED = process.env.ENABLE_TASK_QUEUE === '1';
const DEBUG_ENABLED = process.env.ENABLE_DEBUG_ENDPOINTS === '1';

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

  /* ---------------- 源 3：18comic（jmcomic API 模式，图片前端 canvas 还原） ---------------- */
  comic18: {
    key: 'comic18',
    name: '18comic',
    version: '2.0.0',
    baseUrl: 'https://18comic.vip',
    referer: 'https://18comic.vip/',
    timeout: 30000,
    userAgent: UA,
    imageCdn: [],
    decrypt: { enabled: false },

    rules: {
      home: {
        desc: '列表',
        frontPath: '/api/home',
        path: '/categories/filter',
        /* 只放上游**实测有效**的参数（见 AGENTS.md「分类/排序实测」表）：
         *   page 有效；o 有效（4 个值）；page_size / c / t 均被上游忽略。
         * 早先的 paramMap {type:'c'} 是照 jmcomic Python 库抄的，实测这个
         * App API 节点（2.1.7）对 c 完全不认，留着只会让人误以为能按分类过滤。 */
        params: ['page', 'o'],
        paramDefaults: { o: 'mv' },
        paramWhitelist: { o: ['mr', 'mv', 'mp', 'tf'] },
        match: /^\/api\/home$/
      },

      search: {
        desc: '搜索',
        frontPath: '/api/search',
        path: '/search',
        params: ['keyword', 'page', 'o', 'main_tag'],
        paramMap: { keyword: 'search_query' },
        paramDefaults: { main_tag: '0', o: 'mr' },
        paramWhitelist: { o: ['mr', 'mv', 'mp', 'tf'] },
        match: /^\/api\/search$/
      },

      /* 分类树 + 标签块：上游 /categories 一次给全（10 个大类含子分类、4 组共 47 个标签）。
       * 前端不再硬编码分类表 —— 早期硬编码的 12 项里，id 7 之后全错
       * （真实 7=Cosplay、8=3D、9=禁漫汉化组，根本没有「古风/玄幻/校园/悬疑/恐怖/搞笑」）。 */
      categories: {
        desc: '分类树 + 标签块',
        frontPath: '/api/categories',
        path: '/categories',
        params: [],
        match: /^\/api\/categories$/
      },

      /* 官方首页推荐位：一次返回 8 个块（每块 30 部）。
       * 代理端只保留 type 为 promote / not_in_category_id / category_id 的块，
       * 丢掉 library（书库 id 不是 album id）与 novels（小说，无图）。 */
      promote: {
        desc: '首页推荐位',
        frontPath: '/api/promote',
        path: '/promote',
        params: [],
        match: /^\/api\/promote$/
      },
      detail: {
        desc: '作品详情',
        frontPath: '/api/comic/',
        path: '/album',
        params: [],
        match: /^\/api\/comic\/(\d+)$/,
        vars: { id: 1 },
        varToQuery: { id: 'id' }
      },
      chapters: {
        desc: '章节列表',
        frontPath: '/api/comic/',
        path: '/album',
        params: [],
        match: /^\/api\/comic\/(\d+)\/chapters$/,
        vars: { id: 1 },
        varToQuery: { id: 'id' }
      },
      images: {
        desc: '图片列表',
        frontPath: '/api/comic/image/',
        path: '/chapter',
        params: [],
        match: /^\/api\/comic\/image\/(\d+)$/,
        vars: { cid: 1 },
        varToQuery: { cid: 'id' }
      }
    },

    /* 首页由 rules.promote 的 8 个官方推荐位驱动（见 serveData 的 promote 分支），
     * 不再用固定栏目，所以这里是空数组：前端据此隐藏所有静态栏目。 */
    homeSections: [],

    /* 详情页可点击维度（facets）：前端根据此配置动态渲染可点击元素 */
    facets: [
      { field: 'tags',     type: 'tag',      label: '标签', clickAction: 'search' },
      { field: 'author',   type: 'author',   label: '作者', clickAction: 'search' }
    ],

    /* 图片：浏览器直连 CDN（ACAO:*），前端 canvas 切片还原 */
    imageRule: {
      desc: '18comic 图片（浏览器直连 CDN）',
      match: /^\/media\//,
      direct: true,                  // 直连 CDN，不走 proxy 转发（主域名 403）
      cdn: false,
      decrypt: false
    }
  }
};

const DEFAULT_SOURCE = 'manwaxu';

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
/* 生产环境把 HTML 缓存在内存里省一次 fs 读；但本地调 UI 时这个缓存很坑——
   改了 manga_reader.html 后不重启进程，浏览器拿到的还是旧版，容易误判成
   「代码没生效」。dev-server.js 会置 DEV_RELOAD_HTML=1 关掉缓存。 */
const HTML_NO_CACHE = process.env.DEV_RELOAD_HTML === '1';

function readFrontend() {
  if (_htmlCache && !HTML_NO_CACHE) return _htmlCache;
  const candidates = [
    path.join(process.cwd(), 'manga_reader.html'),
    path.join(__dirname, '..', 'manga_reader.html'),
    path.join(__dirname, 'manga_reader.html')
  ];
  for (let i = 0; i < candidates.length; i++) {
    try {
      const html = fs.readFileSync(candidates[i], 'utf8');
      _htmlCache = html;
      return html;
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

  /* 3) 取值白名单：上游对非法值**不报错**，而是返回垃圾数据。
   *    实测 18comic 的 o=tr / o=md / o=随便写 会返回 65536、262144、1441792
   *    这类移位后的 id（真实 id 不可能是 2 的幂），前端会渲染出一堆点不进去的卡片。
   *    所以非法值必须在这里丢掉，并回落到 paramDefaults。 */
  const wl = rule.paramWhitelist || {};
  Object.keys(wl).forEach(k => {
    if (!out.has(k)) return;
    const allowed = wl[k] || [];
    if (allowed.indexOf(out.get(k)) < 0) {
      if (defaults[k] !== undefined) out.set(k, defaults[k]);
      else out.delete(k);
    }
  });
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

/** 判断是否是 comic18 源（走直连反代，不经任务队列） */
function isComic18(src) {
  return src && src.key === 'comic18';
}

/**
 * comic18 直连反代：Vercel Node.js 直接调 18comic API
 * 
 * 签名算法（从 jmcomic Python 库逆向）：
 *   ts = 当前时间戳（秒）
 *   token = md5(ts + APP_TOKEN_SECRET)
 *   tokenparam = ts + ',' + APP_VERSION
 * 
 * 响应格式：{ code: 200, data: "<AES加密>" }
 * AES 解密：aes-256-ecb，key = md5(ts + APP_DATA_SECRET) 的 UTF-8 字节（32B），无 IV
 *           （早期注释误写为 CBC + 前 16 字节 IV，与实现不符，已订正）
 */
/* 18comic API 域名池。
 * 实测（2026-10）：www.cdnhjk.net / www.cdngwc.net / www.cdngwc.club 返回 200 加密 JSON；
 *                  www.cdngwc.cc 已失效（官方列表也已移除）。
 * 这些域名不经过 Cloudflare 盾（与主站 18comic.vip 不同），是绕盾的关键。
 * 运维可用 COMIC18_API_DOMAINS=a.com,b.com 覆盖，覆盖后不再自动更新。
 */
const COMIC18_API_DOMAINS = (process.env.COMIC18_API_DOMAINS
  ? process.env.COMIC18_API_DOMAINS.split(',').map(s => s.trim()).filter(Boolean)
  : [
      'www.cdnhjk.net',
      'www.cdnutc.me',
      'www.cdngwc.net',
      'www.cdngwc.club'
    ]);

/* ---- 官方域名更新源（与 jmcomic 同一套机制）----
 * 三个字节 TOS 地址存的是 AES-256-ECB 加密的 JSON，解出来是当前有效的 API 域名。
 * 算法：base64 → key=md5('' + secret) 的 UTF-8 字节 → aes-256-ecb → 去 PKCS 填充 → JSON
 * 这样域名池能自动跟随官方，域名失效时不需要改代码重新部署。
 */
const COMIC18_DOMAIN_SERVER_URLS = [
  'https://rup4a04-c01.tos-ap-southeast-1.bytepluses.com/newsvr-2025.txt',
  'https://rup4a04-c02.tos-cn-hongkong.bytepluses.com/newsvr-2025.txt',
  'https://rup4a04-c03.tos-cn-beijing.bytepluses.com.cn/newsvr-2025.txt'
];
const COMIC18_DOMAIN_SERVER_SECRET = 'diosfjckwpqpdfjkvnqQjsik';
const COMIC18_DOMAIN_TTL_MS = 30 * 60 * 1000;

/* 进程内域名池：内置列表打底，官方源刷新后替换 */
const comic18DomainPool = {
  list: COMIC18_API_DOMAINS.slice(),
  updatedAt: 0,      // 0 = 从未成功刷新
  refreshing: null   // 单飞：同一时刻只允许一个刷新在跑
};

/** 解密官方域名源的响应体 */
function comic18DecodeDomainServer(text) {
  let s = String(text || '').replace(/^\uFEFF/, '').trim();
  while (s && s.charCodeAt(0) > 127) s = s.slice(1);   // 去掉开头的非 ASCII 字节
  const buf = Buffer.from(s, 'base64');
  const key = Buffer.from(
    crypto.createHash('md5').update('' + COMIC18_DOMAIN_SERVER_SECRET, 'utf8').digest('hex'),
    'utf8'
  );
  const d = crypto.createDecipheriv('aes-256-ecb', key, null);
  d.setAutoPadding(false);
  let out = Buffer.concat([d.update(buf), d.final()]);
  const pad = out[out.length - 1];
  if (pad > 0 && pad <= 16) out = out.subarray(0, out.length - pad);
  return JSON.parse(out.toString('utf8'));
}

/** 拉取并更新域名池；失败静默保留旧列表（不能因为更新失败就断服务） */
async function comic18RefreshDomainPool() {
  for (let i = 0; i < COMIC18_DOMAIN_SERVER_URLS.length; i++) {
    const url = COMIC18_DOMAIN_SERVER_URLS[i];
    try {
      const r = await fetchRaw(url, { 'user-agent': UA }, 8000);
      if (r.status !== 200 || !r.body || !r.body.length) continue;
      const j = comic18DecodeDomainServer(r.body.toString('utf8'));
      /* 官方返回两个字段：
       *   Server     —— 标准线路
       *   jm3_Server —— 带线路名的扩展列表（形如 [["www.cdnutc.me","線路5"], ...]），
       *                 其中有 Server 里没有的域名（如 www.cdnutc.me），必须一起收。 */
      const official = []
        .concat(Array.isArray(j && j.Server) ? j.Server : [])
        .concat(
          Array.isArray(j && j.jm3_Server)
            ? j.jm3_Server.map(x => (Array.isArray(x) ? x[0] : x))
            : []
        )
        .filter(Boolean);
      if (!official.length) continue;
      /* 官方域名在前，内置列表补在后面兜底；去重 */
      const merged = official.concat(COMIC18_API_DOMAINS).filter((d, idx, arr) => arr.indexOf(d) === idx);
      comic18DomainPool.list = merged;
      comic18DomainPool.updatedAt = Date.now();
      console.log('[proxy] comic18 域名池已更新:', merged.join(','));
      return merged;
    } catch (e) {
      /* 换下一个源 */
    }
  }
  comic18DomainPool.updatedAt = Date.now(); // 避免每次请求都重试失败源
  return null;
}

/** 过期则后台刷新（不阻塞当前请求，下次请求生效） */
function comic18MaybeRefreshDomains() {
  if (process.env.COMIC18_API_DOMAINS) return;          // 运维显式接管，不自动改
  if (comic18DomainPool.refreshing) return;
  if (Date.now() - comic18DomainPool.updatedAt < COMIC18_DOMAIN_TTL_MS) return;
  comic18DomainPool.refreshing = comic18RefreshDomainPool()
    .catch(() => null)
    .then(() => { comic18DomainPool.refreshing = null; });
}

/* 域名健康记忆（进程内，Serverless 实例复用期间有效）
 * 失败域名进入冷却，后续请求优先走健康域名，避免每次请求都先撞一个死域名。 */
const COMIC18_DOMAIN_COOLDOWN_MS = 60 * 1000;
const comic18DomainHealth = new Map(); // domain -> { downUntil, fails, lastError }

/** 按健康度排序：未冷却的在前，冷却中的按解冻时间升序垫底 */
function comic18OrderedDomains() {
  const now = Date.now();
  return comic18DomainPool.list.slice().sort((a, b) => {
    const ha = comic18DomainHealth.get(a);
    const hb = comic18DomainHealth.get(b);
    const da = ha && ha.downUntil > now ? ha.downUntil : 0;
    const db = hb && hb.downUntil > now ? hb.downUntil : 0;
    return da - db;
  });
}

function comic18MarkOk(domain) {
  const h = comic18DomainHealth.get(domain);
  if (h) comic18DomainHealth.delete(domain);
}

function comic18MarkDown(domain, err) {
  const prev = comic18DomainHealth.get(domain) || { fails: 0 };
  comic18DomainHealth.set(domain, {
    fails: prev.fails + 1,
    downUntil: Date.now() + COMIC18_DOMAIN_COOLDOWN_MS,
    lastError: String((err && err.message) || err || 'unknown')
  });
}
const COMIC18_APP_TOKEN_SECRET = '185Hcomic3PAPP7R';
const COMIC18_APP_DATA_SECRET = '185Hcomic3PAPP7R';
const COMIC18_APP_VERSION = '2.1.7';

function comic18Md5(str) {
  return crypto.createHash('md5').update(str, 'utf8').digest('hex');
}

function comic18GenerateAuth() {
  const ts = Math.floor(Date.now() / 1000).toString();
  const token = comic18Md5(ts + COMIC18_APP_TOKEN_SECRET);
  const tokenparam = ts + ',' + COMIC18_APP_VERSION;
  return { ts, token, tokenparam };
}

/** AES-256-ECB 解密（comic18 data 字段，与 jmcomic 库一致） */
function comic18Decrypt(encryptedB64, ts) {
  try {
    const encrypted = Buffer.from(encryptedB64, 'base64');
    // key = md5(ts + secret)，32 字节，utf-8 编码
    const key = Buffer.from(comic18Md5(ts + COMIC18_APP_DATA_SECRET), 'utf8');
    const decipher = crypto.createDecipheriv('aes-256-ecb', key, null);
    decipher.setAutoPadding(true);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (e) {
    return null;
  }
}

/** 18comic CDN 域名列表（从 jmcomic JmModuleConfig.DOMAIN_IMAGE_LIST 提取） */
const COMIC18_CDN_DOMAINS = [
  'cdn-msp.jmapiproxy1.cc',
  'cdn-msp.jmapiproxy2.cc',
  'cdn-msp2.jmapiproxy2.cc',
  'cdn-msp3.jmapiproxy2.cc',
  'cdn-msp.jmapinodeudzn.net',
  'cdn-msp3.jmapinodeudzn.net'
];

/** 将 18comic 封面路径转为完整 CDN URL */
function toComic18Cover(path) {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  const domain = COMIC18_CDN_DOMAINS[0];
  return 'https://' + domain + path;
}

/** 18comic 列表项（/categories/filter、/search、/promote 的 content[]）→ 前端卡片结构。
 *  这三处字段完全一致，抽出来避免三份拷贝走形。 */
function comic18MapListItem(it) {
  // 列表页 image 为空，用 album id 构造封面 URL
  const coverPath = it.cover || it.thumb || it.image || ('/media/albums/' + it.id + '.jpg');
  return {
    id: String(it.id || ''),
    title: it.name || '',
    pic: toComic18Cover(coverPath),
    author: (it.author && it.author.length ? it.author[0] : '') || '',
    tags: (it.category && it.category.title) || '',
    category: it.category || null,  // 保留 category.id 供前端过滤
    tHits: Number(it.total_views) || 0,
    collection: 0,
    status: 1,
    intro: ''
  };
}

/** get_num 的 JS 版本（与 jmcomic Python 一致） */
function comic18GetNum(scrambleId, aid, filename) {
  scrambleId = parseInt(scrambleId) || 0;
  aid = parseInt(aid) || 0;
  if (aid < scrambleId) return 0;
  if (aid < 268850) return 10;
  const x = aid < 421926 ? 10 : 8;
  const s = `${aid}${filename}`;
  const hash = crypto.createHash('md5').update(s, 'utf8').digest('hex');
  const num = hash.charCodeAt(hash.length - 1) % x;
  return num * 2 + 2;
}

/** 从 18comic 图片 URL 提取 filename（不含扩展名） */
function comic18Filename(url) {
  const m = url.match(/\/(\d+)_\d+\.(\w+)$/);
  return m ? m[1] : '';
}

/** comic18 直连请求（带签名 + 解密 + 域名池轮换） */
async function comic18Fetch(path, query, opts) {
  opts = opts || {};
  comic18MaybeRefreshDomains();   // 后台刷新域名池，不阻塞本次请求
  const auth = comic18GenerateAuth();
  const domains = comic18OrderedDomains();
  const tried = [];

  let r = null;
  let bodyStr = null;
  let usedDomain = null;

  for (let i = 0; i < domains.length; i++) {
    const domain = domains[i];
    const baseUrl = `https://${domain}`;
    const headers = {
      'Accept-Encoding': 'identity',
      'user-agent': 'Mozilla/5.0 (Linux; Android 9; V1938CT Build/PQ3A.190705.11211812; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.114 Safari/537.36',
      'token': auth.token,
      'tokenparam': auth.tokenparam,
      'referer': baseUrl + '/',
      'origin': baseUrl
    };

    const url = `${baseUrl}${path}${query ? '?' + query : ''}`;
    try {
      const resp = await fetchRaw(url, headers, 15000);
      if (resp.status !== 200) {
        const snippet = resp.body ? resp.body.toString('utf8').slice(0, 120).replace(/\s+/g, ' ') : '';
        tried.push(`${domain}:HTTP${resp.status}${snippet ? ' ' + snippet : ''}`);
        /* 只有「域名级故障」才进冷却：403（多半是上了 CF 盾）与 5xx。
         * 404 等业务错误不冷却，否则一次查不存在的 id 会把健康域名全拉黑。 */
        if (resp.status === 403 || resp.status >= 500) {
          comic18MarkDown(domain, new Error('HTTP ' + resp.status));
        }
        continue;
      }
      r = resp;
      bodyStr = resp.body.toString('utf8');
      usedDomain = domain;
      comic18MarkOk(domain);
      break;
    } catch (e) {
      tried.push(`${domain}:${e.message}`);
      comic18MarkDown(domain, e);
    }
  }

  if (!r) {
    throw new Error(`comic18 API 全部域名失败: ${tried.join(' | ')}`);
  }

  // raw 模式：直接返回原始 body（用于 /chapter_view_template 等 HTML 响应）
  if (opts.raw) {
    return { raw: bodyStr, status: r.status, domain: usedDomain };
  }

  let j = null;
  try { j = JSON.parse(bodyStr); } catch (e) { j = null; }

  if (!j || j.code !== 200) {
    throw new Error(`comic18 API 返回异常(${usedDomain}): ${bodyStr.substring(0, 200)}`);
  }
  
  // 解密 data 字段（key 依赖 ts）
  if (typeof j.data === 'string') {
    const decrypted = comic18Decrypt(j.data, auth.ts);
    if (decrypted) {
      try {
        j.data = JSON.parse(decrypted);
      } catch (e) {
        j.data = decrypted;
      }
    }
  }
  
  return j;
}

/** 从 /chapter_view_template HTML 中提取 scramble_id */
function comic18ExtractScrambleId(html) {
  if (!html) return 0;
  const m = html.match(/var\s+scramble_id\s*=\s*(\d+)/);
  return m ? parseInt(m[1]) : 0;
}

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
  /* JSON 序列化会把 RegExp 变成 {}，前端就拿不到 match 了。
     额外暴露 matchStr（正则源码），前端用 new RegExp(matchStr) 复原。 */
  const out = Object.assign({}, src);
  out.rules = {};
  Object.keys(src.rules || {}).forEach(k => {
    const r = Object.assign({}, src.rules[k]);
    if (r.match instanceof RegExp) r.matchStr = r.match.source;
    delete r.match;                       // 保留原契约：match 不出现在响应里
    out.rules[k] = r;
  });
  /* imageRule.match 同理：前端用 matchStr 复原正则判断图片归属 */
  if (out.imageRule && src.imageRule.match instanceof RegExp) {
    out.imageRule = Object.assign({}, src.imageRule, { matchStr: src.imageRule.match.source });
    delete out.imageRule.match;
  }
  return res.status(200).send(JSON.stringify(out));
}

/** 源列表接口（不含密钥 / rules / userAgent） */
function serveSources(res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res
    .status(200)
    .send(JSON.stringify({ code: 200, data: sourceList(), default: DEFAULT_SOURCE }));
}

/** 第三步-A：按书源规则取数据 */
/* ============================================================
 * 上游 JSON 短缓存（详情页双请求去重）
 * ------------------------------------------------------------
 * 前端 openDetail() 会先后请求 /api/comic/{id} 和 /api/comic/{id}/chapters，
 * 而 comic18 的 detail 与 chapters 两条规则**都映射到 /album?id=**，
 * 等于同一份数据打两次上游（每次约 0.9s）。这里给上游 JSON 加 20s TTL
 * + 并发合流：第二个请求直接命中，省掉一次跨洋往返。
 *
 * 只缓存「上游原始响应字符串」，每次请求再 parse 一份新对象 —— 因为
 * serveData 拿到对象后会就地改写（j.data.list / j.data.images 等），
 * 直接缓存对象会让第二次请求读到被上一轮改写过的脏数据。
 *
 * UPSTREAM_CACHE_TTL_MS=0 可整体关闭（排查「数据不更新」类问题时的第一开关）。
 * ============================================================ */
const UPSTREAM_CACHE_TTL_MS = Number(process.env.UPSTREAM_CACHE_TTL_MS || 20000);
const UPSTREAM_CACHE_MAX = 200;
const upstreamCache = new Map();     // key -> { at, ttl, json }
const upstreamInflight = new Map();  // key -> Promise

function upstreamCacheSet(key, json, ttl) {
  if (UPSTREAM_CACHE_TTL_MS <= 0) return;
  upstreamCache.set(key, { at: Date.now(), ttl: ttl, json: json });
  if (upstreamCache.size <= UPSTREAM_CACHE_MAX) return;
  const now = Date.now();
  for (const entry of upstreamCache) {
    const k = entry[0], v = entry[1];
    if (now - v.at > (v.ttl || UPSTREAM_CACHE_TTL_MS)) upstreamCache.delete(k);
  }
  // Map 保持插入顺序，超限时从最旧的开始删
  while (upstreamCache.size > UPSTREAM_CACHE_MAX) {
    upstreamCache.delete(upstreamCache.keys().next().value);
  }
}

/** fn 必须返回**字符串**（JSON 文本），返回值也是字符串 */
async function withUpstreamCache(key, fn, ttl) {
  const life = ttl || UPSTREAM_CACHE_TTL_MS;
  if (UPSTREAM_CACHE_TTL_MS <= 0) return fn();
  const hit = upstreamCache.get(key);
  if (hit) {
    if (Date.now() - hit.at <= (hit.ttl || UPSTREAM_CACHE_TTL_MS)) return hit.json;
    upstreamCache.delete(key);
  }
  if (upstreamInflight.has(key)) return upstreamInflight.get(key);
  const p = (async () => {
    try {
      const json = await fn();
      upstreamCacheSet(key, json, life);
      return json;
    } finally {
      upstreamInflight.delete(key);
    }
  })();
  upstreamInflight.set(key, p);
  return p;
}

async function serveData(src, action, rule, target, query, req, res) {
  /* ---- comic18：直连反代（不经任务队列） ---- */
  if (isComic18(src)) {
    try {
      const vars = extractVars(rule, target, query);
      const upPath = fillPath(rule.path, vars);
      const upQuery = buildUpstreamQuery(rule, query, null);
      // varToQuery：把路径里的 id 作为 query 参数传给上游（如 /album?id=123）
      const extraQ = [];
      if (rule.varToQuery) {
        Object.keys(rule.varToQuery).forEach(vk => {
          const uq = rule.varToQuery[vk];
          const val = vars[vk];
          if (val !== undefined && val !== null && val !== '') extraQ.push(uq + '=' + encodeURIComponent(val));
        });
      }
      const allQ = [upQuery].concat(extraQ.filter(Boolean)).join('&');
      /* 分类树变化极慢（官方一天也改不了几次），给 30 分钟；
       * 其余（列表/详情/章节/图片）用默认 20s，只为吃掉详情页那次重复请求。 */
      const cacheKey = 'c18|' + upPath + '|' + allQ;
      const cacheTtl = (action === 'categories') ? 30 * 60 * 1000 : 0;
      const j = JSON.parse(await withUpstreamCache(
        cacheKey,
        async () => JSON.stringify(await comic18Fetch(upPath, allQ)),
        cacheTtl
      ));

      /* 分类树 + 标签块：/categories 原始结构是
       *   { categories: [{id,name,slug,type,total_albums,sub_categories:[{CID,name,slug}]}],
       *     blocks: [{title, content:[标签名…]}] }
       * 这里把 CID/type/total_albums 这些上游命名改成前端统一的小写字段。 */
      if (action === 'categories' && j.data && Array.isArray(j.data.categories)) {
        const cats = j.data.categories.map(c => ({
          id: String(c.id),
          name: c.name || '',
          slug: c.slug || '',
          /* type 是「怎么查这个分类」的关键：
           *   'slug'   → 官方网页按分类过滤
           *   'search' → 官方自己也是拿 slug 去搜索（Cosplay / 3D / 禁漫汉化组）
           * 本 App API 的 c 参数被忽略，所以两条路在前端都统一走关键词搜索。 */
          type: c.type || 'slug',
          total: Number(c.total_albums) || 0,
          subs: (c.sub_categories || []).map(s => ({
            id: String(s.CID || ''),
            name: s.name || '',
            slug: s.slug || ''
          }))
        })).filter(c => c.name);
        const blocks = (j.data.blocks || []).map(b => ({
          title: b.title || '',
          tags: Array.isArray(b.content) ? b.content : []
        }));
        j.data = { categories: cats, blocks: blocks };
      }

      // images：/chapter 返回 images 数组，还需 /chapter_view_template 拿 scramble_id
      if (action === 'images' && j.data && Array.isArray(j.data.images)) {
        const photoId = j.data.id || vars.cid || 0;
        // 先调 chapter_view_template 拿 scramble_id（HTML 响应，用 raw 模式）
        let scrambleId = 0;
        try {
          const ts = Math.floor(Date.now() / 1000);
          const scrPath = '/chapter_view_template?id=' + photoId + '&mode=vertical&page=0&app_img_shunt=1&express=off&v=' + ts;
          const scr = await comic18Fetch(scrPath, '', { raw: true });
          scrambleId = comic18ExtractScrambleId(scr.raw);
        } catch (e) { /* scramble 获取失败不影响图片加载 */ }
        j.data.scrambleId = scrambleId;
        j.data.images = j.data.images.map((im, i) => {
          // im 可能是字符串（如 "00001.webp"）或对象（如 {url: "..."}）
          let filename = '';
          if (typeof im === 'string') {
            filename = im;
          } else if (im && typeof im === 'object') {
            filename = im.url || im.img_url || im.filename || '';
          }
          // 拼接 CDN URL：https://cdn-msp.{domain}/media/photos/{photo_id}/{index:05}{suffix}
          const cdnUrl = 'https://' + COMIC18_CDN_DOMAINS[0] + '/media/photos/' + photoId + '/' + filename;
          const blockNum = comic18GetNum(scrambleId, photoId, filename.replace(/\.\w+$/, ''));
          return {
            url: cdnUrl,
            urlOrig: cdnUrl,
            index: i,
            blockNum: blockNum
          };
        });
      }

      // home/search：把 content 映射成前端认的 list/comicList
      if ((action === 'home' || action === 'search') && j.data && j.data.content) {
        const arr = Array.isArray(j.data.content) ? j.data.content : [];
        const list = arr.map(comic18MapListItem).filter(x => x.id);
        j.data.list = list;
        j.data.comicList = list;
      }

      /* promote：官方首页推荐位，8 个块（每块 30 部）。
       * 但只有前 6 个是「漫画相册」，后两个是别的实体，必须过滤掉：
       *   library → 书库条目（id 是书库 id，如 3310828，点进 /album 打不开）
       *   novels  → 小说（没有图片，阅读器无法渲染）
       * 这也是为什么这里按 type 白名单，而不是全量透传。 */
      if (action === 'promote' && Array.isArray(j.data)) {
        const ALLOW_TYPES = ['promote', 'not_in_category_id', 'category_id'];
        const blocks = j.data
          .filter(b => b && ALLOW_TYPES.indexOf(b.type) >= 0)
          .map(b => ({
            // 上游标题带运营提示，如「连载更新→右滑看更多→」，去掉尾部箭头段
            title: String(b.title || '').replace(/→[^→]*→\s*$/, '').trim(),
            type: b.type,
            filterVal: b.filter_val == null ? '' : String(b.filter_val),
            list: (Array.isArray(b.content) ? b.content : []).map(comic18MapListItem).filter(x => x.id)
          }))
          .filter(b => b.title && b.list.length);
        j.data = { blocks: blocks };
      }

      // detail/chapters：区分 /album 和 /api/comic/{id}/chapters 两种响应格式
      if ((action === 'detail' || action === 'chapters') && j.data) {
        const album = j.data;
        let chapters = [];
        if (Array.isArray(album.series)) {
          // /album 格式：从 series 数组提取章节
          chapters = album.series.map((s, i) => ({
            id: String(s.id || ''),
            title: s.name || ('第' + (i + 1) + '话'),
            sortId: i + 1,
            // /album 的 series 不含 total_photos，真实图片数由 /chapter 的 images 数组长度决定
            // 前端展示用 "?" 表示未知，fetchImages 会实时获取
            picCount: Number(s.total_photos) || 0,
            isVip: s.need_buy || false,
            addtime: s.addtime || ''
          }));
        } else if (Array.isArray(album.list)) {
          // /api/comic/{id}/chapters 格式：已经是章节列表
          chapters = album.list.map((s, i) => ({
            id: String(s.id || ''),
            title: s.title || s.name || ('第' + (i + 1) + '话'),
            sortId: s.sortId || (i + 1),
            picCount: Number(s.picCount || s.total_photos) || 0,
            isVip: s.isVip || s.need_buy || false,
            addtime: s.addtime || ''
          }));
        }

        /* 单话作品兜底：CG 集/短篇的 /album 会返回 series: []、series_id: "0"，
         * 但 total_photos > 0，且 photo_id 就等于 album_id（实测 141130：454 张图）。
         * 不兜底的话前端会显示「0 话 / 无章节」。 */
        if (!chapters.length && album.id && Number(album.total_photos) > 0) {
          chapters = [{
            id: String(album.id),
            title: album.name || '本作品',
            sortId: 1,
            picCount: Number(album.total_photos),
            isVip: false,
            addtime: album.addtime || ''
          }];
        }
        if (action === 'detail') {
          // 详情页：映射为前端认的 info 对象
          // 封面 URL：/album 返回的 cover 可能是路径，用 toComic18Cover 拼接
          const coverPath = album.cover || album.thumb || ('/media/albums/' + album.id + '.jpg');
          const coverUrl = toComic18Cover(coverPath);
          j.data = {
            id: String(album.id || ''),
            title: album.name || '',
            author: (album.author && album.author.length ? album.author[0] : '') || '',
            cover: coverUrl,
            pic: coverUrl,
            // 注意：18comic /album 不返回 category 字段，分类联动从列表页触发
            tags: (album.tags && album.tags.length ? album.tags.join(',') : ''),
            intro: album.description || '',
            tHits: Number(album.total_views) || 0,
            collection: Number(album.likes) || 0,
            status: 1,
            chapters: chapters
          };
        } else {
          // chapters：返回 list
          j.data = { list: chapters, total: chapters.length };
        }
      }

      setCors(res);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).send(JSON.stringify(j));
    } catch (err) {
      setCors(res);
      return res.status(502).json({
        error: err.message,
        rule: action,
        target: target,
        source: src.name
      });
    }
  }

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
 * 五、任务队列（短轮询版）
 * ============================================================ */

const TASK_TTL = 300; // 5 分钟（秒）

// Vercel KV (Upstash Redis) 客户端，跨实例共享任务状态
let kv = null;
try {
  const { createClient } = require('@vercel/kv');
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    kv = createClient({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
    console.log('[proxy] KV (Redis) 已连接');
  } else {
    console.warn('[proxy] KV_REST_API_URL/TOKEN 未配置，回退内存模式（不跨实例）');
  }
} catch (e) {
  console.warn('[proxy] @vercel/kv 不可用，回退内存模式:', e.message);
}

// 内存 fallback（仅开发/测试用）
const memTasks = new Map();

async function kvGetTask(id) {
  if (kv) {
    const d = await kv.get(`task:${id}`);
    return d ? (typeof d === 'string' ? JSON.parse(d) : d) : null;
  }
  return memTasks.get(id) || null;
}

async function kvSetTask(task) {
  if (kv) {
    await kv.set(`task:${task.id}`, JSON.stringify(task), { ex: TASK_TTL });
  } else {
    memTasks.set(task.id, task);
  }
}

async function kvClaimPending() {
  if (kv) {
    // 扫描所有 task key（任务量小，scan 足够）
    const keys = [];
    let cursor = 0;
    do {
      const [next, batch] = await kv.scan(cursor, { match: 'task:*', count: 100 });
      cursor = Number(next);
      keys.push(...batch);
    } while (cursor !== 0);

    // 取所有 pending 任务，找最早的
    let picked = null;
    for (const key of keys) {
      const d = await kv.get(key);
      if (!d) continue;
      const t = typeof d === 'string' ? JSON.parse(d) : d;
      if (t.status === 'pending' && (!picked || t.created < picked.created)) {
        picked = t;
      }
    }
    return picked;
  }
  // 内存模式
  let picked = null;
  for (const t of memTasks.values()) {
    if (t.status === 'pending' && (!picked || t.created < picked.created)) picked = t;
  }
  return picked;
}

async function cleanupTasks() {
  if (!kv) {
    const now = Date.now();
    for (const [id, t] of memTasks) {
      if (now - t.created > TASK_TTL * 1000) memTasks.delete(id);
    }
  }
  // Redis 有 TTL，无需手动清理
}

async function createTask(apiPath) {
  await cleanupTasks();
  const id = crypto.randomUUID();
  const task = {
    id,
    api_path: apiPath,
    status: 'pending',
    created: Date.now(),
    result: null,
  };
  await kvSetTask(task);
  return id;
}

async function handleTaskCreate(req, res, apiPath) {
  const id = await createTask(apiPath);
  setCors(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ task_id: id, api_path: apiPath });
}

/**
 * worker 认领任务：取最早的一个 pending 任务并标记为 processing
 * 没有待办任务时返回 204，避免 worker 空转创建垃圾任务
 */
async function handleTaskClaim(req, res) {
  await cleanupTasks();
  const picked = await kvClaimPending();
  setCors(res);
  res.setHeader('Cache-Control', 'no-store');
  if (!picked) return res.status(204).end();
  picked.status = 'processing';
  picked.claimed = Date.now();
  await kvSetTask(picked);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(200).json({ task_id: picked.id, api_path: picked.api_path });
}

async function handleTaskStatus(req, res, taskId) {
  const t = await kvGetTask(taskId);
  if (!t) {
    setCors(res);
    return res.status(404).json({ error: 'task not found', task_id: taskId });
  }
  setCors(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  const result = t.result || {};
  return res.status(200).json({
    task_id: t.id,
    status: t.status,
    api_path: t.api_path,
    // done 和 failed 都要回传 result，否则前端看不到失败原因
    result: (t.status === 'done' || t.status === 'failed') ? result : null,
  });
}

function handleCallback(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' });
  }
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', async () => {
    try {
      const data = JSON.parse(body);
      const id = data.task_id;
      const t = await kvGetTask(id);
      if (!t) {
        setCors(res);
        return res.status(404).json({ error: 'task not found', task_id: id });
      }
      // 存储 HTML 内容到 result
      t.result = {
        status: data.status,
        title: data.title,
        content: data.content,
        content_length: data.content_length,
        error: data.error,
      };
      t.status = data.status === 'ok' ? 'done' : 'failed';
      t.finished = Date.now();
      await kvSetTask(t);
      setCors(res);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(200).json({ ok: true });
    } catch (e) {
      setCors(res);
      return res.status(400).json({ error: 'invalid JSON' });
    }
  });
}

/* ============================================================
 * 六、入口
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

  /* --- 运维开关：调试端点默认关闭（会吐签名 token 与上游原始响应） --- */
  if (pathname.indexOf('/api/debug/') === 0 && !DEBUG_ENABLED) {
    setCors(res);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(404).json({
      error: 'debug endpoints disabled',
      hint: '设置环境变量 ENABLE_DEBUG_ENDPOINTS=1 后重新部署即可启用'
    });
  }

  /* --- 运维开关：任务队列默认关闭（comic18 已改直连，不再需要 worker） --- */
  if (
    ['/task', '/claim', '/status', '/callback'].indexOf(pathname) >= 0 &&
    !TASK_QUEUE_ENABLED
  ) {
    setCors(res);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(410).json({
      error: 'task queue disabled',
      hint: 'comic18 主链路已改为直连 API 域名，无需 worker；确需启用请设 ENABLE_TASK_QUEUE=1',
      reason: '/callback 无鉴权，按 task_id 即可写入任意结果，长期开启等于把任务数据交给任何人'
    });
  }

  /* --- 临时 DEBUG：测试所有 18comic API 域名 --- */
  if (pathname === '/api/debug/comic18-chapters' && req.method === 'GET') {
    const id = sp.get('id') || '302569';
    const auth = comic18GenerateAuth();
    const ua = 'Mozilla/5.0 (Linux; Android 9; V1938CT Build/PQ3A.190705.11211812; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.114 Safari/537.36';
    const results = {};

    for (const domain of COMIC18_API_DOMAINS) {
      const baseUrl = `https://${domain}`;
      try {
        const r = await fetchRaw(`${baseUrl}/api/comic/${id}/chapters`, {
          'user-agent': ua, 'token': auth.token, 'tokenparam': auth.tokenparam,
          'referer': baseUrl + '/', 'origin': baseUrl
        }, 15000);
        const body = r.body.toString('utf8');
        results[domain] = { status: r.status, body: body.substring(0, 800) };
      } catch (e) {
        results[domain] = { error: e.message };
      }
    }

    return res.json({ debug: { token: auth.token, tokenparam: auth.tokenparam }, results });
  }

  /* --- 图片代理：CDN 无 CORS 头，通过 proxy 转发图片字节 --- */
  if (pathname === '/api/image' && req.method === 'GET') {
    const imgUrl = url.searchParams.get('url');
    if (!imgUrl) {
      setCors(res);
      return res.status(400).json({ error: 'missing url param' });
    }
    try {
      const u = new URL(imgUrl);
      /* 白名单与 COMIC18_CDN_DOMAINS 共用一份，避免两处域名列表漂移 */
      if (COMIC18_CDN_DOMAINS.indexOf(u.hostname) < 0) {
        setCors(res);
        return res.status(403).json({ error: 'domain not allowed', host: u.hostname });
      }
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 9; V1938CT Build/PQ3A.190705.11211812; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.114 Safari/537.36',
        'Referer': 'https://' + u.hostname + '/',
        'Origin': 'https://' + u.hostname,
        'Accept': '*/*',
      };
      const r = await fetchRaw(imgUrl, headers, 15000);
      setCors(res);
      res.setHeader('Content-Type', r.headers['content-type'] || 'image/jpeg');
      if (r.status === 200 && r.body && r.body.length > 0) {
        /* 图片字节由 URL 唯一确定（photo_id + 文件名），可放心长缓存：
         *   浏览器 1 天 / 边缘节点 1 年，避免每张图都回源打到函数（成本与 30s 超时风险） */
        res.setHeader(
          'Cache-Control',
          'public, max-age=86400, s-maxage=31536000, stale-while-revalidate=86400, immutable'
        );
      } else {
        res.setHeader('Cache-Control', 'no-store');
      }
      return res.status(r.status).send(r.body);
    } catch (e) {
      setCors(res);
      return res.status(502).json({ error: e.message });
    }
  }

  /* --- DEBUG：部署指纹 + 配置快照 --- */
  if (pathname === '/api/debug/build-info' && req.method === 'GET') {
    const homeRule = SOURCES.comic18.rules.home;
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    return res.json({
      sha: process.env.VERCEL_GIT_COMMIT_SHA || 'unknown',
      nodeEnv: process.env.NODE_ENV,
      homeRule: {
        params: homeRule.params,
        paramMap: homeRule.paramMap || null,
        paramDefaults: homeRule.paramDefaults || null,
      },
      ts: Date.now(),
    });
  }

  /* --- DEBUG：验证 buildUpstreamQuery 实际输出 --- */
  if (pathname === '/api/debug/query-mapping' && req.method === 'GET') {
    const homeRule = SOURCES.comic18.rules.home;
    const q = buildUpstreamQuery(homeRule, sp, null);
    const upPath = fillPath(homeRule.path, {});
    const upstream = SOURCES.comic18.baseUrl + upPath + (q ? '?' + q : '');
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      sha: process.env.VERCEL_GIT_COMMIT_SHA || 'unknown',
      input_query: sp.toString(),
      type_param: sp.get('type'),
      upstream_query: q,
      upstream_url: upstream,
    });
  }

  /* --- DEBUG：复用 home action 请求逻辑，对比 c=8 vs c=0 上游原始响应 --- */
  if (pathname === '/api/debug/api-compare' && req.method === 'GET') {
    const src = SOURCES.comic18;
    const rule = src.rules.home;

    const baseParams = { page: '1', pageSize: '12', o: 'mv' };
    const q0 = buildUpstreamQuery(rule, new URLSearchParams({ ...baseParams, type: '0' }), null);
    const q8 = buildUpstreamQuery(rule, new URLSearchParams({ ...baseParams, type: '8' }), null);
    const url0 = src.baseUrl + rule.path + (q0 ? '?' + q0 : '');
    const url8 = src.baseUrl + rule.path + (q8 ? '?' + q8 : '');

    // 复用 home action 的 headers 构造
    const headers = upstreamHeaders(src, req);

    const [r0, r8] = await Promise.all([
      fetchRaw(url0, headers, 15000),
      fetchRaw(url8, headers, 15000),
    ]);

    const t0 = r0.body.toString('utf8');
    const t8 = r8.body.toString('utf8');

    const parse = s => { try { return JSON.parse(s); } catch { return null; } };
    const isCF = s => /cloudflare|challenge|checking your browser|cf-ray/i.test(s);
    const j0 = parse(t0);
    const j8 = parse(t8);

    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      sha: process.env.VERCEL_GIT_COMMIT_SHA || 'unknown',
      url0,
      url8,
      status: [r0.status, r8.status],
      cfChallenge: [isCF(t0), isCF(t8)],
      len: [t0.length, t8.length],
      identical: t0 === t8,
      diff: (j0 && j8) ? {
        code: [j0.code, j8.code],
        errorMsg: [j0.errorMsg, j8.errorMsg],
        total: [j0.data?.total, j8.data?.total],
        firstId0: j0.data?.list?.[0]?.id,
        firstId8: j8.data?.list?.[0]?.id,
      } : null,
      preview0: t0.slice(0, 500),
      preview8: t8.slice(0, 500),
    });
  }

  /* --- 任务队列：短轮询四个端点 --- */
  // 前端：创建任务
  if (pathname === '/task' && req.method === 'GET') {
    const apiPath = sp.get('path') || '/albums';
    return handleTaskCreate(req, res, apiPath);
  }
  // worker：认领待办任务（无任务返回 204）
  if (pathname === '/claim' && req.method === 'GET') {
    return handleTaskClaim(req, res);
  }
  // 前端：轮询任务状态
  if (pathname === '/status' && req.method === 'GET') {
    const taskId = sp.get('task_id');
    if (!taskId) return res.status(400).json({ error: 'task_id required' });
    return handleTaskStatus(req, res, taskId);
  }
  // worker：回传结果
  if (pathname === '/callback' && req.method === 'POST') {
    return handleCallback(req, res);
  }

  // 选定源：不带 src 时回落默认源（旧链接 / 旧缓存继续可用）
  const src = resolveSource(sp.get('src'));

  // 显式目标优先，裸路径兜底
  let target = sp.get('p') || pathname;
  if (target.charAt(0) !== '/') target = '/' + target;

  // 转发时剔除内部参数（p / src / host 都不透传给上游）
  const rest = new URLSearchParams(sp);
  rest.delete('p');
  rest.delete('src');
  rest.delete('host');
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
