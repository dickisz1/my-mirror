#!/usr/bin/env node
'use strict';

/**
 * 本地开发服务器 —— 不依赖 vercel CLI
 * ============================================================
 * 作用：把 vercel.json 的「/(.*) → /api/proxy」重写规则在本地复现，
 *       让 manga_reader.html + api/proxy.js 走完整链路。
 *
 * 用法：
 *   node dev-server.js            # 默认 3000 端口
 *   PORT=3999 node dev-server.js  # 指定端口
 *
 * 打开 http://127.0.0.1:3000/ 就是站点首页；左上角下拉可切换书源。
 * 每个请求都会打印状态码、耗时，便于对照前端 DevTools。
 */

const http = require('http');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
/* 本地调试时关掉 proxy.js 里的 HTML 内存缓存：
   改了 manga_reader.html 刷新即可生效，不用重启本进程 */
process.env.DEV_RELOAD_HTML = '1';
const handler = require(path.join(__dirname, 'api', 'proxy.js'));

/** 把原生 ServerResponse 补齐成 Vercel 函数用的 Express 风格接口 */
function wrapResponse(res) {
  res.status = code => { res.statusCode = code; return res; };
  res.json = obj => {
    if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
    return res;
  };
  res.send = body => {
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : String(body));
    return res;
  };
  return res;
}

const server = http.createServer((req, res) => {
  /* 浏览器会自动请求 favicon，直接 204，避免日志里刷 404 噪音 */
  if (req.url === '/favicon.ico') {
    res.statusCode = 204;
    return res.end();
  }

  const started = Date.now();
  wrapResponse(res);

  res.on('finish', () => {
    const target = req.url.length > 96 ? req.url.slice(0, 96) + '…' : req.url;
    console.log(`  ${String(res.statusCode).padEnd(3)} ${String(Date.now() - started).padStart(5)}ms  ${target}`);
  });

  Promise.resolve(handler(req, res)).catch(err => {
    console.error('  handler error:', err && err.stack || err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: String(err && err.message || err) }));
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  my-mirror 本地开发服务器');
  console.log('  ' + '-'.repeat(50));
  console.log(`  站点      http://127.0.0.1:${PORT}/`);
  console.log(`  源列表    http://127.0.0.1:${PORT}/api/proxy?p=/api/sources`);
  console.log(`  调试端点  默认关闭（ENABLE_DEBUG_ENDPOINTS=1 打开）`);
  console.log('  ' + '-'.repeat(50));
  console.log('  提示：默认源是 manwaxu，若本机连不上它会看到 502，');
  console.log('        在页面左上角下拉切到 18comic 即可（走 API 域名，通常更快）。');
  console.log('');
});

process.on('SIGINT', () => {
  console.log('\n  已停止');
  server.close(() => process.exit(0));
});
