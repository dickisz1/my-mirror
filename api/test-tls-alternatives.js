/**
 * 测试：Vercel 环境能否加载 tls-impersonate 和 curl-cffi-node
 * 
 * 验证目标：
 * 1. tls-impersonate 预编译二进制能否在 Vercel 加载
 * 2. curl-cffi-node NAPI-RS 绑定能否在 Vercel 加载
 */
const crypto = require('crypto');
const https = require('https');
const tls = require('tls');

const APP_TOKEN_SECRET = '185Hcomic3PAPP7R';
const APP_VERSION = '2.1.11';
const API_DOMAINS = ['www.cdnhjk.net', 'www.cdngwc.cc', 'www.cdngwc.net', 'www.cdngwc.club'];

function md5(str) {
  return crypto.createHash('md5').update(str, 'utf8').digest('hex');
}

function generateAuth() {
  const ts = Math.floor(Date.now() / 1000).toString();
  const token = md5(ts + APP_TOKEN_SECRET);
  const tokenparam = ts + ',' + APP_VERSION;
  return { ts, token, tokenparam };
}

function fetchWithTls(host, path, headers, tlsContext) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: host,
      port: 443,
      path: path,
      method: 'GET',
      headers: headers,
      timeout: 15000,
      rejectUnauthorized: false
    };
    
    if (tlsContext) {
      options.secureContext = tlsContext;
    }
    
    const req = https.get(options, (res) => {
      let data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => resolve({ 
        status: res.statusCode, 
        headers: res.headers, 
        body: Buffer.concat(data) 
      }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
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
    tls_impersonate: { loaded: false, version: null, error: null },
    curl_cffi_node: { loaded: false, version: null, error: null },
    fetch_success: false,
    fetch_status: null,
    fetch_error: null,
    fetch_elapsed_ms: null,
    body_length: null,
    is_cf_challenge: null,
    body_preview: null,
    auth: null
  };
  
  // 测试 tls-impersonate
  try {
    const tlsImp = require('tls-impersonate');
    result.tls_impersonate.loaded = true;
    result.tls_impersonate.version = tlsImp.version || 'unknown';
  } catch (err) {
    result.tls_impersonate.error = err.message;
  }
  
  // 测试 curl-cffi-node
  try {
    const c = require('curl-cffi-node');
    result.curl_cffi_node.loaded = true;
    result.curl_cffi_node.version = c.version || 'unknown';
  } catch (err) {
    result.curl_cffi_node.error = err.message;
  }
  
  // 生成签名
  const auth = generateAuth();
  result.auth = { ts: auth.ts, token: auth.token, tokenparam: auth.tokenparam };
  
  const headers = {
    'Accept-Encoding': 'identity',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    'token': auth.token,
    'tokenparam': auth.tokenparam
  };
  
  const targetUrl = `https://${domain}${testPath}`;
  const startTime = Date.now();
  
  try {
    // 尝试用 tls-impersonate 创建 secure context
    let tlsContext = null;
    if (result.tls_impersonate.loaded) {
      try {
        const tlsImp = require('tls-impersonate');
        // 尝试 impersonate Chrome
        const clientHello = tlsImp.impersonate('chrome_142');
        if (clientHello && clientHello.tlsOptions) {
          tlsContext = clientHello.tlsOptions;
        }
      } catch (e) {
        // 忽略，继续用默认 TLS
      }
    }
    
    const response = await fetchWithTls(domain, testPath, headers, tlsContext);
    result.fetch_elapsed_ms = Date.now() - startTime;
    result.fetch_status = response.status;
    
    const bodyStr = response.body.toString('utf8');
    result.body_length = bodyStr.length;
    result.body_preview = bodyStr.substring(0, 500);
    result.is_cf_challenge = bodyStr.includes('Just a moment') || bodyStr.includes('cf-mitigated');
    
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
