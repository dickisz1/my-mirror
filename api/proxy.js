export default async function handler(req, res) {
  const targetHost = "manwa.me";
  const myHost = req.headers.host;
  const url = `https://${targetHost}${req.url}`;

  // 1. 搬运浏览器原始头信息，确保“勾选”动作合法
  const requestHeaders = {};
  const headersToCopy = ['user-agent', 'accept', 'accept-language', 'cookie', 'referer', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform'];
  headersToCopy.forEach(h => {
    if (req.headers[h]) requestHeaders[h] = req.headers[h].split(myHost).join(targetHost);
  });

  try {
    // 【核心关卡】验证零件直通模式：遇到 cdn-cgi 不做任何处理，直接搬运，保证框一定能出
    if (req.url.includes('cdn-cgi/')) {
      const cfRes = await fetch(url, { method: req.method, headers: requestHeaders });
      const cfData = await cfRes.arrayBuffer();
      res.setHeader("Content-Type", cfRes.headers.get("content-type"));
      return res.status(cfRes.status).send(Buffer.from(cfData));
    }

    const response = await fetch(url, {
      method: req.method,
      headers: requestHeaders,
      body: (req.method !== 'GET' && req.method !== 'HEAD') ? JSON.stringify(req.body) : undefined,
      redirect: 'manual'
    });

    // 2. 响应头同步：修改 Set-Cookie 的域名，让浏览器存下通关秘钥
    response.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      if (lowerKey === 'content-encoding') return;
      if (lowerKey === 'set-cookie') {
        // 抹掉 Domain 限制，解决浏览器拒收通关令牌的问题
        const modifiedCookie = value.replace(/Domain=[^;]+;?/gi, "").replace(new RegExp(targetHost, 'g'), myHost);
        res.appendHeader('Set-Cookie', modifiedCookie);
      } else {
        res.setHeader(key, value.replace(new RegExp(targetHost, 'g'), myHost));
      }
    });

    // 3. 处理重定向
    if (response.status >= 300 && response.status < 400) {
      const loc = response.headers.get('location');
      if (loc) res.setHeader('Location', loc.replace(targetHost, myHost));
      return res.status(response.status).send('');
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      let text = await response.text();
      
      // 【新增功能】桌面通知 JS 注入
      const notifyJS = `
      <script>
        (function() {
          if ("Notification" in window) {
            Notification.requestPermission();
          }
          // 监控验证状态并通知
          let notified = false;
          setInterval(() => {
            const hasToken = document.cookie.includes("cf_clearance");
            const hasBox = document.querySelector('iframe') || document.querySelector('#cf-turnstile-wait');
            
            if (hasBox && !notified) {
              new Notification("验证框已就绪", { body: "请点击确认您是真人进行打勾操作。" });
              notified = true;
            }
            if (hasToken) {
              new Notification("通关成功！", { body: "正在为您跳转至漫蛙首页..." });
              setTimeout(() => { location.reload(); }, 2000);
            }
          }, 2000);
        })();
      </script>`;

      text = text.replace('</head>', `${notifyJS}</head>`);
      return res.status(response.status).send(text.split(targetHost).join(myHost));
    }

    const buffer = await response.arrayBuffer();
    return res.status(response.status).send(Buffer.from(buffer));

  } catch (err) {
    return res.status(502).send("连接异常，请重试: " + err.message);
  }
}
