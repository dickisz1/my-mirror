'use strict';

/**
 * 18comic helper 配置（最小可跑版）
 *
 * 你后面要进这套框架，建议：
 *   1. 代理出口写成 COMIC_HELPER_PROXY
 *      - 本地开发：http://127.0.0.1:10808
 *      - 墙外 VPS：直接访问 18comic.vip/cdn 的地址
 *   2. 图源优先级：
 *      - 首页：18comic.vip
 *      - 图片：cdn-msp*.18comic.vip（实测 18comic.vip/media 403，cdn 200）
 *   3. CF 挑战先不自动处理，交给人工/用户层兜住。
 */

const CONFIG = {
  host: '127.0.0.1',
  port: 8765,

  // 18comic.vip 通过谁出
  // 你当前可用：http://127.0.0.1:10808
  // 后面如果换成墙外 VPS，只要能从那边访问 18comic.vip 就行
  proxyUrl: process.env.COMIC_HELPER_PROXY || process.env.HTTP_PROXY || process.env.HTTPS_PROXY || 'http://127.0.0.1:20810',

  // 18comic 源站
  comic18: {
    host: '18comic.vip',
    baseUrl: 'https://18comic.vip',
    referer: 'https://18comic.vip/',
    homeBase: 'https://18comic.vip',

    // 首页请求
    list: {
      defaultPath: '/albums',
      defaultLimit: 24,
    },

    // 图片源
    // 实测：18comic.vip/media/... 403
    //       cdn-msp*.18comic.vip/media/... 200
    image: {
      hostBase: 'https://cdn-msp0.18comic.vip',
      fallbackHosts: [
        'https://cdn-msp0.18comic.vip',
        'https://cdn-msp1.18comic.vip',
        'https://cdn-msp2.18comic.vip',
      ],
      // 你以后如果有更准的 CDN host 池，直接改这里
      // 示例：[ 'https://cdn-msp0.18comic.vip', 'https://cdn-msp1.18comic.vip' ]
    },

    // 超时，单位 ms
    timeout: {
      http: 60000,
      home: 240000,
      image: 60000,
      default: 60000,
    },

    // CF 过盾：CloakBrowser (WSL Ubuntu) 自动获取 cf_clearance
    // 前提：WSL + cloakbrowser + xvfb 已就绪
    cf: {
      enabled: true,
      autoHandle: true,
      cookieCacheFile: '/tmp/cf_clearance_cache.json',
      cookieTTL: 30 * 60 * 1000, // 30 分钟
      note: 'CloakBrowser (WSL) auto-solves CF challenge. Cookie cached for 30min.',
    },
  },
};

function getProxyUrl() {
  return CONFIG.proxyUrl;
}

function getComic18() {
  return CONFIG.comic18;
}

function getConfig() {
  return CONFIG;
}

module.exports = {
  getConfig,
  getComic18,
  getProxyUrl,
  getProxy: getProxyUrl,
};
