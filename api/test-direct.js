/**
 * 测试：Vercel Node.js 直接调 18comic API（无轮询、无 Worker）
 * 
 * 验证目标：
 * 1. Vercel 出口 IP 能否访问 18comic API
 * 2. Node.js 复现的签名是否有效
 * 3. 响应是否正常（非 CF 挑战页）
 * 
 * 测试端点：/api/test-direct
 */
const https = require('https');
const http = require('http');
const zlib = require('zlib');

// jmcomic 密钥（从 jm_config.py 逆向）
const APP_TOKEN_SECRET = '185Hcomic3PAPP7R';
const APP_VERSION = '2.1.11';

// 18comic API 域名（从 worker 日志确认）
const API_DOMAINS = [
  'www.cdnhjk.net',
  'www.cdngwc.cc',
  'www.cdngwc.net',
  'www.cdngwc.club'
];

function md5(str) {
  return require('crypto').createHash('md5').update(str, 'utf8').digest('hex');
}

function generateAuth() {
  const ts = Math.floor(Date.now() / 1000).toString();
  const token = md5(ts + APP_TOKEN_SECRET);
  const tokenparam = ts + ',' + APP_VERSION;
  return { ts, token, tokenparam };
}

function fetchWithTimeout(host, path, headers, timeout) {
  return new Promise((resolve, reject) => {
    const req = https.get(`https://${host}${path}`, {
      headers,
      timeout,
      rejectUnauthorized: false
    }, (res) => {
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
  
  // 测试参数：path（默认 /setting）
  const testPath = sp.get('path') || '/setting';
  const domain = sp.get('domain') || API_DOMAINS[0];
  
  // 生成签名
  const auth = generateAuth();
  
  // 构造请求头（模拟 jmcomic 的 APP_HEADERS_TEMPLATE）
  const headers = {
    'Accept-Encoding': 'identity',
    'user-agent': 'Mozilla/5.0 (Linux; Android 9; V1938CT Build/PQ3A.190705.11211812; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.114 Safari/537.36',
    'token': auth.token,
    'tokenparam': auth.tokenparam
  };

  const startTime = Date.now();

  try {
    const response = await fetchWithTimeout(domain, testPath, headers, 15000);
    const elapsed = Date.now() - startTime;
    
    // 解压 gzip
    let bodyBuffer = response.body;
    const encoding = response.headers['content-encoding'];
    if (encoding && encoding.includes('gzip')) {
      bodyBuffer = await new Promise((resolve, reject) => {
        zlib.gunzip(response.body, (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
    }
    
    // 检查是否是 CF 挑战页
    const bodyStr = bodyBuffer.toString('utf8');
    const isCFChallenge = bodyStr.includes('Just a moment') || bodyStr.includes('cf-mitigated');
    
    // 尝试解析 JSON
    let parsed = null;
    try { parsed = JSON.parse(bodyStr); } catch(e) {}
    
    // 构造响应
    const result = {
      success: response.status === 200 && !isCFChallenge && parsed !== null,
      domain: domain,
      path: testPath,
      status: response.status,
      elapsed_ms: elapsed,
      body_length: bodyBuffer.length,
      is_cf_challenge: isCFChallenge,
      is_valid_json: parsed !== null,
      json_keys: parsed ? Object.keys(parsed) : null,
      body_preview: bodyStr.substring(0, 500),
      auth: {
        ts: auth.ts,
        token: auth.token,
        tokenparam: auth.tokenparam
      }
    };
    
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    
    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(502).json(result);
    }
  } catch (err) {
    const elapsed = Date.now() - startTime;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    res.status(500).json({
      success: false,
      domain: domain,
      path: testPath,
      error: err.message,
      elapsed_ms: elapsed,
      auth: {
        ts: auth.ts,
        token: auth.token,
        tokenparam: auth.tokenparam
      }
    });
  }
};
