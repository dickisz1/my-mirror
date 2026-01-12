export default async function handler(req, res) {
  const targetHost = "manwa.me";
  const myHost = req.headers.host;
  const url = `https://${targetHost}${req.url}`;

  // 1. 构造请求头：强制删除可能导致 403 的追踪头
  const requestHeaders = {};
  const headersToCopy = ['user-agent', 'accept', 'accept-language', 'cookie', 'referer', 'priority'];
  headersToCopy.forEach(h => {
    if (req.headers[h]) requestHeaders[h] = req.headers[h].split(myHost).join(targetHost);
  });
  
  // 强制伪装成直接访问，防止被识别为代理
  requestHeaders['sec-fetch-site'] = 'none';
  requestHeaders['sec-fetch-mode'] = 'navigate';
  requestHeaders['sec-fetch-dest'] = 'document';

  try {
    // 【核心修复】验证脚本路径豁免，必须保证这些文件原封不动
    if (req.url.includes('cdn-cgi/') || req.url.includes('invisible.js')) {
      const cfRes = await fetch(url, { headers: requestHeaders });
      const cfData = await cfRes.arrayBuffer();
      res.setHeader("Content-Type", cfRes.headers.get("content-type"));
      res.setHeader("Cache-Control", "public, max-age=3600");
      return res.status(200).send(Buffer.from(cfData));
    }

    const response = await fetch(url, {
      method: req.method,
      headers: requestHeaders,
      redirect: 'manual'
    });

    // 2. 捕获通关秘钥：确保打勾后令牌能存入浏览器
    response.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      if (lowerKey === 'set-cookie') {
        const modifiedCookie = value.replace(/Domain=[^;]+;?/gi, "").replace(new RegExp(targetHost, 'g'), myHost);
        res.appendHeader('Set-Cookie', modifiedCookie);
      } else if (lowerKey !== 'content-encoding' && lowerKey !== 'content-security-policy') {
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
      
      // 注入桌面通知与脚本激活逻辑
      const injectScript = `
      <script>
        (function() {
          // 请求通知权限
          if ("Notification" in window && Notification.permission === "default") {
            Notification.requestPermission();
          }
          
          // 监控验证码是否加载成功
          setTimeout(() => {
            const iframe = document.querySelector('iframe[src*="cloudflare"]');
            if (!iframe) {
              console.log("检测到验证框未出现，尝试修复渲染...");
              // 这里的逻辑是如果没框，尝试给通知提醒用户再次刷新
              new Notification("验证框加载失败", { body: "请尝试刷新页面或切换网络。" });
            } else {
              new Notification("验证框已就绪", { body: "请点击打勾以获取通关秘钥。" });
            }
          }, 5000);
        })();
      </script>`;
      
      text = text.replace('</head>', `${injectScript}</head>`);
      return res.status(response.status).send(text.split(targetHost).join(myHost));
    }

    const buffer = await response.arrayBuffer();
    return res.status(response.status).send(Buffer.from(buffer));

  } catch (err) {
    return res.status(502).send("连接异常: " + err.message);
  }
}
