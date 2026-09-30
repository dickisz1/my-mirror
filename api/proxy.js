// Vercel Node.js Proxy for manwaxu.cc
const https = require('https');
const http = require('http');
const { URL } = require('url');

const TARGET = "manwaxu.cc";
const CDN = "tu.mwzu.cc";
const TIMEOUT = 10000;

function fetchWithTimeout(host, path, headers, timeout) {
  return new Promise((resolve, reject) => {
    const proto = host === CDN ? https : https;
    const req = proto.get(`https://${host}${path}`, {
      headers,
      timeout,
      rejectUnauthorized: false
    }, (res) => {
      let data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(data) }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const path = url.pathname;
  
  let targetPath = path.replace('/api/proxy', '') || '/';
  let targetHost = TARGET;
  
  if (targetPath.includes('/en_images/')) {
    targetHost = CDN;
  }
  
  try {
    const response = await fetchWithTimeout(targetHost, targetPath, {
      'Host': targetHost,
      'Referer': `https://${TARGET}/`,
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0'
    }, TIMEOUT);
    
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    
    // Copy headers (except set-cookie and transfer-encoding)
    Object.keys(response.headers).forEach(k => {
      if (k !== 'set-cookie' && k !== 'transfer-encoding') {
        res.setHeader(k, response.headers[k]);
      }
    });
    
    res.status(response.status).send(response.body);
  } catch (err) {
    res.status(502).json({ error: err.message, target: `https://${targetHost}${targetPath}` });
  }
};