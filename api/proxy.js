export default async function handler(req, res) {
  const targetHost = "manwa.me";
  const myHost = req.headers.host;
  const url = `https://${targetHost}${req.url}`;

  // 1. 照搬浏览器头信息
  const requestHeaders = {};
  const headersToCopy = [
    'user-agent', 'accept', 'accept-language', 'cookie', 
    'referer', 'priority', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform'
  ];
  
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

    // 2. 响应头处理：修复图标和秘钥存储
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'content-encoding') return;
      
      // 特别处理 Set-Cookie，否则令牌存不下，图标也会因为跨域拒收
      if (key.toLowerCase() === 'set-cookie') {
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

    // 4. 内容处理：注入通知并防止脚本崩溃
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      let text = await response.text();
      
      // 注入通知脚本：图标出来、打勾、通关都会发消息
      const injectScript = `
      <script>
        (function() {
          if ("Notification" in window && Notification.permission !== "granted") {
            Notification.requestPermission();
          }
          setInterval(() => {
            if (document.querySelector('iframe')) {
              if (!window.notifiedBox) {
                new Notification("验证框已就绪", { body: "图标已加载，请点击打勾。" });
                window.notifiedBox = true;
              }
            }
            if (document.cookie.includes("cf_clearance")) {
              new Notification("通关成功", { body: "秘钥已同步，正在进入首页。" });
            }
          }, 2000);
        })();
      </script>`;

      text = text.replace('</head>', `${injectScript}</head>`);
      return res.status(response.status).send(text.split(targetHost).join(myHost));
    }

    // 5. 其他资源（图标、JS零件）原样转发
    const buffer = await response.arrayBuffer();
    return res.status(response.status).send(Buffer.from(buffer));

  } catch (err) {
    return res.status(502).send("脚本代连异常: " + err.message);
  }
}
