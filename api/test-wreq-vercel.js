/**
 * 测试：Vercel 环境能否安装和使用 wreq-js
 * 
 * 验证目标：
 * 1. Vercel 构建时能否成功安装 wreq-js（原生 Rust 绑定）
 * 2. Vercel 运行时能否加载 wreq-js 模块
 * 3. wreq-js 能否在 Vercel 环境调通 18comic API
 */
const crypto = require('crypto');

// jmcomic 密钥
const APP_TOKEN_SECRET = '185Hcomic3PAPP7R';
const APP_VERSION = '2.1.11';
const API_DOMAINS = [
  'www.cdnhjk.net',
  'www.cdngwc.cc',
  'www.cdngwc.net',
  'www.cdngwc.club'
];

function md5(str) {
  return crypto.createHash('md5').update(str, 'utf8').digest('hex');
}

function generateAuth() {
  const ts = Math.floor(Date.now() / 1000).toString();
  const token = md5(ts + APP_TOKEN_SECRET);
  const tokenparam = ts + ',' + APP_VERSION;
  return { ts, token, tokenparam };
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const sp = url.searchParams;
  
  const testPath = sp.get('path') || '/categories/filter?page=1&order=&c=all&o=mv';
  const domain = sp.get('domain') || API_DOMAINS[0];
  
  const result = {
    node_version: process.version,
    platform: process.platform,
    arch: process.arch,
    vercel_region: process.env.VERCEL_REGION || 'unknown',
    wreq_js_loaded: false,
    wreq_js_version: null,
    fetch_success: false,
    fetch_status: null,
    fetch_error: null,
    fetch_elapsed_ms: null,
    body_length: null,
    is_cf_challenge: null,
    body_preview: null,
    auth: null
  };
  
  // 尝试加载 wreq-js
  let fetch;
  try {
    const wreq = require('wreq-js');
    fetch = wreq.fetch;
    result.wreq_js_loaded = true;
    try {
      const pkg = require('path').join(process.cwd(), 'node_modules', 'wreq-js', 'package.json');
      const fs = require('fs');
      result.wreq_js_version = JSON.parse(fs.readFileSync(pkg, 'utf8')).version;
    } catch(e) {
      result.wreq_js_version = 'unknown';
    }
  } catch (err) {
    result.fetch_error = `wreq-js 加载失败: ${err.message}`;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json(result);
  }
  
  // 生成签名
  const auth = generateAuth();
  result.auth = { ts: auth.ts, token: auth.token, tokenparam: auth.tokenparam };
  
  const targetUrl = `https://${domain}${testPath}`;
  const startTime = Date.now();
  
  try {
    const response = await fetch(targetUrl, {
      browser: 'chrome_142',
      os: 'windows',
      headers: {
        'Accept-Encoding': 'identity',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
        'token': auth.token,
        'tokenparam': auth.tokenparam
      }
    });
    
    result.fetch_elapsed_ms = Date.now() - startTime;
    result.fetch_status = response.status;
    
    const body = await response.text();
    result.body_length = body.length;
    result.body_preview = body.substring(0, 500);
    result.is_cf_challenge = body.includes('Just a moment') || body.includes('cf-mitigated');
    
    if (response.status === 200 && !result.is_cf_challenge) {
      result.fetch_success = true;
    }
    
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    res.status(result.fetch_success ? 200 : 502).json(result);
  } catch (err) {
    result.fetch_elapsed_ms = Date.now() - startTime;
    result.fetch_error = err.message;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    res.status(500).json(result);
  }
};
