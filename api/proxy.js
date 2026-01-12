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

    // 1. 响应头全量处理：修复图标加载与秘钥存储
    response.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      if (lowerKey === 'content-encoding') return;
      
      if (lowerKey === 'set-cookie') {
        // 关键：确保 cf_clearance 被浏览器接受
        const modifiedCookie = value
          .replace(/Domain=[^;]+;?/gi, "") 
          .replace(/Path=[^;]+;?/gi, "Path=/;")
          .replace(/Secure/gi, "") // 临时移除 Secure 以便在某些非全 HTTPS 环境调试
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
      
      // 2. 注入“通关监控”脚本：如果桌面通知不亮，就用网页弹窗
      const finalScript = `
      <script>
        (function() {
          console.log("监控启动：等待通关秘钥...");
          
          function notifyUser(msg) {
            if ("Notification" in window && Notification.permission === "granted") {
              new Notification(msg);
            } else {
              console.log("【通关状态】: " + msg);
              // 如果通知权限没开，直接在页面顶部显示一个绿条
              let div = document.createElement('div');
              div.style = "position:fixed;top:0;left:0;width:100%;background:green;color:white;text-align:center;z-index:99999;padding:10px;";
              div.innerText = msg;
              document.body.appendChild(div);
            }
          }

          let checkToken = setInterval(() => {
            if (document.cookie.includes("cf_clearance")) {
              notifyUser("🎉 通关令牌已到手！正在进入漫蛙...");
              clearInterval(checkToken);
              setTimeout(() => { window.location.reload(); }, 1000);
            }
          }, 1500);

          // 询问通知权限
          if ("Notification" in window && Notification.permission === "default") {
            Notification.requestPermission();
          }
        })();
      </script>`;

      text = text.replace('</head>', `${finalScript}</head>`);
      return res.status(response.status).send(text.split(targetHost).join(myHost));
    }

    const buffer = await response.arrayBuffer();
    return res.status(response.status).send(Buffer.from(buffer));

  } catch (err) {
    return res.status(502).send("秘钥同步中断: " + err.message);
  }
}
