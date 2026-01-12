export default async function handler(req, res) {
  const targetHost = "manwa.me";
  const myHost = req.headers.host;
  const url = `https://${targetHost}${req.url}`;

  // 1. 头信息搬运
  const requestHeaders = {};
  const headersToCopy = ['user-agent', 'accept', 'accept-language', 'cookie', 'referer', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform'];
  headersToCopy.forEach(h => {
    if (req.headers[h]) requestHeaders[h] = req.headers[h].split(myHost).join(targetHost);
  });

  try {
    const response = await fetch(url, {
      method: req.method,
      headers: requestHeaders,
      body: (req.method !== 'GET' && req.method !== 'HEAD') ? req.body : undefined,
      redirect: 'manual'
    });

    // 2. 【核心改进】强力 Cookie 搬运工
    // 获取漫蛙返回的所有 Set-Cookie
    const rawCookies = response.headers.getSetCookie(); 
    
    if (rawCookies && rawCookies.length > 0) {
      rawCookies.forEach(cookie => {
        // 彻底拆解并重组 Cookie，去掉所有可能导致拒收的限制
        let parts = cookie.split(';');
        let newParts = parts.map(part => {
          let p = part.trim();
          if (p.toLowerCase().startsWith('domain=')) return null; // 删域名
          if (p.toLowerCase().startsWith('samesite=')) return 'SameSite=Lax'; // 降级安全策略
          if (p.toLowerCase() === 'secure') return null; // 非 HTTPS 环境也允许
          return p.replace(targetHost, myHost);
        }).filter(p => p !== null);
        
        // 确保路径是全局的
        if (!newParts.some(p => p.toLowerCase().startsWith('path='))) {
          newParts.push('Path=/');
        }
        
        res.appendHeader('Set-Cookie', newParts.join('; '));
      });
    }

    // 3. 转发其他响应头
    response.headers.forEach((v, k) => {
      if (!['set-cookie', 'content-encoding', 'content-length'].includes(k.toLowerCase())) {
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
      
      const debugScript = `
      <script>
        (function() {
          function showStatus(msg, color) {
            let d = document.getElementById('debug-bar') || document.createElement('div');
            d.id = 'debug-bar';
            d.style = "position:fixed;top:0;left:0;width:100%;background:"+color+";color:white;text-align:center;z-index:99999;padding:8px;font-weight:bold;";
            d.innerText = msg;
            if(!d.parentNode) document.body.prepend(d);
          }

          console.log("Cookie 监控中...");
          setInterval(() => {
            const cookies = document.cookie;
            if (cookies.includes("cf_clearance")) {
              showStatus("✅ 秘钥捕捉成功！正在尝试跳转...", "green");
              setTimeout(() => { location.href = '/'; }, 1500);
            } else {
              // 在控制台输出当前所有可见 Cookie，方便排查
              console.log("当前 Cookies:", cookies);
              showStatus("❌ 状态：打勾后未检测到秘钥 (橙条)", "orange");
            }
          }, 2000);
        })();
      </script>`;

      text = text.replace('</head>', `${debugScript}</head>`);
      return res.status(response.status).send(text.split(targetHost).join(myHost));
    }

    const buffer = await response.arrayBuffer();
    return res.status(response.status).send(Buffer.from(buffer));

  } catch (err) {
    return res.status(502).send("错误: " + err.message);
  }
}
