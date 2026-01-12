export default async function handler(req, res) {
  const targetHost = "manwa.me";
  const myHost = req.headers.host;
  const url = `https://${targetHost}${req.url}`;

  const requestHeaders = {};
  const headersToCopy = ['user-agent', 'accept', 'accept-language', 'cookie', 'referer', 'priority', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform'];
  
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

    // 1. 响应头处理：【通关令牌强行修正】
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'content-encoding') return;
      
      if (key.toLowerCase() === 'set-cookie') {
        // 关键：把令牌里的 Domain 去掉，并把 Path 设为根目录，确保全局有效
        const modifiedCookie = value
          .replace(/Domain=[^;]+;?/gi, "") 
          .replace(/Path=[^;]+;?/gi, "Path=/;")
          .replace(new RegExp(targetHost, 'g'), myHost);
        res.appendHeader('Set-Cookie', modifiedCookie);
      } else {
        res.setHeader(key, value.replace(new RegExp(targetHost, 'g'), myHost));
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
      
      // 2. 注入“打勾成功”桌面通知脚本
      const finalScript = `
      <script>
        (function() {
          if ("Notification" in window && Notification.permission === "default") {
            Notification.requestPermission();
          }
          // 监控秘钥是否生成
          let checkToken = setInterval(() => {
            if (document.cookie.includes("cf_clearance")) {
              new Notification("通关令牌已就绪！", { body: "正在带您进入漫蛙首页，请稍候..." });
              clearInterval(checkToken);
              // 令牌到手，立即尝试跳转
              setTimeout(() => { window.location.href = window.location.origin; }, 1500);
            }
          }, 1000);
        })();
      </script>`;

      text = text.replace('</head>', `${finalScript}</head>`);
      return res.status(response.status).send(text.split(targetHost).join(myHost));
    }

    const buffer = await response.arrayBuffer();
    return res.status(response.status).send(Buffer.from(buffer));

  } catch (err) {
    return res.status(502).send("打勾后续处理异常: " + err.message);
  }
}
