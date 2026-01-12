export default async function handler(req, res) {
  const targetHost = "manwa.me";
  const myHost = req.headers.host;
  const url = `https://${targetHost}${req.url}`;

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

    // 1. 深度同步所有 Cookie，特别是通关秘钥
    const setCookies = response.headers.getSetCookie();
    if (setCookies.length > 0) {
      setCookies.forEach(cookie => {
        // 强制抹除 Domain 限制，确保你的浏览器肯收下它
        const cleanCookie = cookie
          .replace(/Domain=[^;]+;?/gi, "") 
          .replace(/Path=[^;]+;?/gi, "Path=/;")
          .replace(/Secure/gi, "") 
          .replace(/SameSite=None/gi, "SameSite=Lax")
          .split(targetHost).join(myHost);
        res.appendHeader('Set-Cookie', cleanCookie);
      });
    }

    // 2. 复制其他响应头
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
      
      // 3. 注入“状态诊断”绿条/红条
      const debugScript = `
      <script>
        (function() {
          function showStatus(msg, color) {
            let d = document.getElementById('debug-bar') || document.createElement('div');
            d.id = 'debug-bar';
            d.style = "position:fixed;top:0;left:0;width:100%;background:"+color+";color:white;text-align:center;z-index:99999;padding:5px;font-size:12px;";
            d.innerText = msg;
            if(!d.parentNode) document.body.appendChild(d);
          }

          setInterval(() => {
            if (document.cookie.includes("cf_clearance")) {
              showStatus("✅ 秘钥已拿到！尝试刷新进入...", "green");
              setTimeout(() => { location.reload(); }, 2000);
            } else {
              showStatus("❌ 还没拿到秘钥，请在上方打勾", "orange");
            }
          }, 2000);
        })();
      </script>`;

      text = text.replace('</body', `${debugScript}</body`);
      return res.status(response.status).send(text.split(targetHost).join(myHost));
    }

    const buffer = await response.arrayBuffer();
    return res.status(response.status).send(Buffer.from(buffer));

  } catch (err) {
    return res.status(502).send("连接错误: " + err.message);
  }
}
