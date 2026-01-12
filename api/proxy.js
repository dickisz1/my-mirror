export default async function handler(req, res) {
  const targetHost = "manwa.me";
  const myHost = req.headers.host;
  const url = `https://${targetHost}${req.url}`;

  // 1. 基础头信息伪装
  const requestHeaders = {};
  const headersToCopy = ['user-agent', 'accept', 'accept-language', 'cookie', 'referer', 'priority', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform'];
  headersToCopy.forEach(h => {
    if (req.headers[h]) requestHeaders[h] = req.headers[h].split(myHost).join(targetHost);
  });

  try {
    // 【逻辑 1：验证框优先】如果是验证零件，执行“无损直通”，确保你能顺利打勾
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

    // 【逻辑 2：令牌接收】只有在非 cdn-cgi 请求时，才精准捕获并修正通关秘钥
    response.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      if (lowerKey === 'content-encoding') return;
      if (lowerKey === 'set-cookie') {
        const modifiedCookie = value.replace(/Domain=[^;]+;?/gi, "").replace(new RegExp(targetHost, 'g'), myHost);
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
      
      // 【逻辑 3：注入桌面通知脚本】
      const notificationScript = `
      <script>
        (function() {
          if ("Notification" in window) {
            if (Notification.permission !== "granted") {
              Notification.requestPermission();
            }
          }
          // 监控验证码状态
          setInterval(() => {
            const statusText = document.body.innerText;
            if (statusText.includes("正在验证") || statusText.includes("Checking your browser")) {
              console.log("正在等待打勾...");
            } else if (document.cookie.includes("cf_clearance")) {
              new Notification("漫蛙通关成功！", { body: "秘钥已存入浏览器，正在进入首页...", icon: "/favicon.ico" });
            }
          }, 3000);
          
          window.onload = () => {
            if (!document.cookie.includes("cf_clearance")) {
              new Notification("需要验证", { body: "请点击页面上的验证框进行打勾操作。" });
            }
          };
        })();
      </script>
      `;
      
      // 在 </head> 前插入通知脚本，并替换域名
      text = text.replace('</head>', `${notificationScript}</head>`);
      return res.status(response.status).send(text.split(targetHost).join(myHost));
    }

    const buffer = await response.arrayBuffer();
    return res.status(response.status).send(Buffer.from(buffer));

  } catch (err) {
    return res.status(502).send("脚本代连异常: " + err.message);
  }
}
