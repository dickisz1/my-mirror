export default async function handler(req, res) {
  const targetHost = "manwa.me";
  const myHost = req.headers.host;
  const url = `https://${targetHost}${req.url}`;

  // 1. 头信息：严格模拟真实浏览器
  const requestHeaders = {};
  const headersToCopy = ['user-agent', 'accept', 'accept-language', 'cookie', 'referer', 'content-type'];
  headersToCopy.forEach(h => {
    if (req.headers[h]) requestHeaders[h] = req.headers[h].split(myHost).join(targetHost);
  });

  try {
    // 【核心修复：处理 POST 请求体】解决截图中的 415 错误
    let requestBody = undefined;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      // 如果是验证码发的 json 数据，原样转过去
      requestBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }

    const response = await fetch(url, {
      method: req.method,
      headers: requestHeaders,
      body: requestBody,
      redirect: 'manual'
    });

    // 2. 响应头：多 Cookie 捕获补丁
    const rawCookies = response.headers.getSetCookie();
    if (rawCookies.length > 0) {
      rawCookies.forEach(cookie => {
        const cleanCookie = cookie
          .replace(/Domain=[^;]+;?/gi, "") 
          .replace(/Path=[^;]+;?/gi, "Path=/;")
          .replace(/SameSite=None/gi, "SameSite=Lax")
          .replace(/Secure/gi, "")
          .split(targetHost).join(myHost);
        res.appendHeader('Set-Cookie', cleanCookie);
      });
    }

    // 3. 基础响应头转发
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
      
      // 4. 注入强力监控（如果拿到秘钥，直接弹窗并强制刷新）
      const monitorScript = `
      <script>
        (function() {
          console.log("正在全力捕捉 cf_clearance...");
          setInterval(() => {
            if (document.cookie.includes("cf_clearance")) {
              alert("🎉 秘钥拿到！正在强制进入首页！");
              location.href = window.location.origin;
            }
          }, 1500);
          
          // 桌面通知保底
          if (Notification.permission === "default") Notification.requestPermission();
          if (document.cookie.includes("cf_clearance")) {
             new Notification("通关成功！");
          }
        })();
      </script>`;

      text = text.replace('</head>', `${monitorScript}</head>`);
      return res.status(response.status).send(text.split(targetHost).join(myHost));
    }

    const buffer = await response.arrayBuffer();
    return res.status(response.status).send(Buffer.from(buffer));

  } catch (err) {
    return res.status(502).send("打勾通信异常: " + err.message);
  }
}
