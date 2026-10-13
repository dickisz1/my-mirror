const crypto = require('crypto');
const https = require('https');

const DOMAINS = ['jmcomic.onl', 'jmcomic1.onl', 'jmcomic2.onl'];

function generateAuth() {
  const ts = Math.floor(Date.now() / 1000);
  const token = crypto.createHash('md5').update(String(ts) + '185Hcomic3PAPP7R').digest('hex');
  return { ts, token, tokenparam: `${ts},1.6.0` };
}

function decrypt(data, ts) {
  const key = crypto.createHash('md5').update(String(ts) + '185Hcomic3PAPP7R').digest('hex');
  const keyBytes = Buffer.from(key, 'hex').slice(0, 16);
  const ivBytes = keyBytes;
  const decipher = crypto.createDecipheriv('aes-128-ecb', keyBytes, null);
  let decrypted = decipher.update(data, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

module.exports = async (req, res) => {
  const domain = DOMAINS[0];
  const auth = generateAuth();
  
  const url = `https://${domain}/album?id=287234`;
  
  const r = await new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'user-agent': 'Mozilla/5.0',
        'token': auth.token,
        'tokenparam': auth.tokenparam
      }
    }, (r) => {
      let body = '';
      r.on('data', d => body += d);
      r.on('end', () => resolve({ status: r.statusCode, body }));
    }).on('error', reject);
  });
  
  if (r.status !== 200) {
    return res.status(500).json({ error: `HTTP ${r.status}` });
  }
  
  const j = JSON.parse(r.body);
  
  // 解密 data
  let data = j.data;
  if (typeof data === 'string') {
    const decrypted = decrypt(data, auth.ts);
    data = JSON.parse(decrypted);
  }
  
  // 返回顶层 key 列表和 data 的 key 列表
  const dataKeys = Object.keys(data);
  
  // 找 category 相关字段
  const categoryFields = {};
  dataKeys.forEach(k => {
    if(k.toLowerCase().includes('cat') || k.toLowerCase().includes('genre') || k.toLowerCase().includes('type') || k.toLowerCase().includes('tag') || k.toLowerCase().includes('class')) {
      const v = data[k];
      if(typeof v === 'string' || typeof v === 'number' || v === null) {
        categoryFields[k] = v;
      } else if(Array.isArray(v)) {
        categoryFields[k] = v.slice(0, 3);
      } else if(typeof v === 'object') {
        categoryFields[k] = JSON.stringify(v).substring(0, 200);
      }
    }
  });
  
  // 也找 author 相关字段
  const authorFields = {};
  dataKeys.forEach(k => {
    if(k.toLowerCase().includes('author') || k.toLowerCase().includes('artist') || k.toLowerCase().includes('writer')) {
      const v = data[k];
      if(typeof v === 'string' || typeof v === 'number' || v === null) {
        authorFields[k] = v;
      } else if(Array.isArray(v)) {
        authorFields[k] = v.slice(0, 3);
      }
    }
  });
  
  return res.status(200).json({
    topLevelKeys: Object.keys(j),
    dataKeys: dataKeys,
    categoryFields: categoryFields,
    authorFields: authorFields,
    // 完整 data 的前 2000 字符
    dataPreview: JSON.stringify(data).substring(0, 2000)
  });
};
