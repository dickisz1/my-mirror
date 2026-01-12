export default async function handler(req, res) {
  const targetHost = "manwa.me";
  const myHost = req.headers.host;
  const url = `https://${targetHost}${req.url}`;

  // 1. 严格头信息还原：解决 415 报错的核心
  const requestHeaders = {};
  const headersToCopy = [
    'user-agent', 'accept', 'accept-language', 'cookie', 
    'referer', 'content-type', 'x-requested-with'
  ];
  
  headersToCopy.forEach(h => {
    if (req.headers[h]) {
      requestHeaders[h] = req.headers[h].split(myHost).join(targetHost);
    }
  });

  try {
    // 2. 正确转发请求体（Body）
    let body = undefined;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      // 必须直接读取原始 buffer，防止 JSON.stringify 改变了验证包的格式
      body = req.body; 
    }

    const response = await fetch(url, {
      method: req.method,
      headers: requestHeaders,
      body: body,
      redirect: 'manual'
    });

    // 3. 响应头：多 Cookie 强制写回
    const setCookies = response.headers.getSetCookie();
    if (setCookies.length > 0) {
      setCookies.forEach(cookie => {
        const cleanCookie = cookie
          .replace(/Domain=[^;]+;?/gi, "") 
          .replace(/Path=[^;]+;?/gi, "Path=/;")
          .replace(/SameSite=None/gi, "SameSite=Lax")
          .replace(/Secure/gi, "") // 允许在非 HTTPS 下存储
          .split(targetHost).join(myHost);
        res.appendHeader('Set-Cookie', cleanCookie);
      });
    }

    // 4. 清除干扰安全策略 (CSP)
    response.headers.forEach((v, k) => {
      const lowKey = k.toLowerCase();
      if (!['set-cookie', 'content-encoding', 'content-length', 'content-security-policy'].includes(lowKey)) {
        res.setHeader(k, v.replace(new RegExp(targetHost, 'g'), myHost));
      }
    });

    if (response.status >= 300 && response.status < 400) {
      const loc = response.headers.get('location');
      if (loc) res.setHeader('Location', loc.replace(targetHost, myHost));
      return res.status(response.status).send('');
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      let text = await response.text();
      
      // 注入【强力通关条】：成功拿到秘钥会变绿并弹窗
      const monitorScript = `
      <script>
        (function() {
          function updateBar(msg, color) {
            let b = document.getElementById('pass-bar') || document.createElement('div');
            b.id = 'pass-bar';
            b.style = "position:fixed;top:0;left:0;width:100%;background:"+color+";color:white;text-align:center;z-index:99999;padding:10px;font-weight:bold;";
            b.innerText = msg;
            if(!b.parentNode) document.body.prepend(b);
          }
          
          setInterval(() => {
            if (document.cookie.includes("cf_clearance")) {
              updateBar("🎉 通关秘钥已拿到！点击此处进入首页", "green");
              document.getElementById('pass-bar').onclick = () => { location.href = '/'; };
              // 自动尝试跳转
              setTimeout(() => { location.href = '/'; }, 2000);
            } else {
              updateBar("⏳ 还没拿到秘钥，请在下方打勾确认...", "#ff9800");
            }
          }, 1000);
        })();
      </script>`;

      text = text.replace('</head>', `${monitorScript}</head>`);
      return res.status(response.status).send(text.split(targetHost).join(myHost));
    }

    const buffer = await response.arrayBuffer();
    return res.status(response.status).send(Buffer.from(buffer));

  } catch (err) {
    return res.status(502).send("打勾失败: " + err.message);
  }
}
