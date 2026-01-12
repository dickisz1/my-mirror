export default async function handler(req, res) {
  const targetHost = "manwa.me";
  const myHost = req.headers.host;
  const url = `https://${targetHost}${req.url}`;

  // 1. 获取原始请求头（排除干扰 Vercel 内部转发的头部）
  const requestHeaders = {};
  const forbiddenHeaders = ['host', 'connection', 'content-length'];
  Object.keys(req.headers).forEach(key => {
    if (!forbiddenHeaders.includes(key.toLowerCase())) {
      requestHeaders[key] = req.headers[key].toString().replace(new RegExp(myHost, 'g'), targetHost);
    }
  });

  try {
    // 2. 发起请求
    const response = await fetch(url, {
      method: req.method,
      headers: requestHeaders,
      redirect: 'manual'
    });

    // 3. 处理响应头（包括通关 Cookie 的写回）
    response.headers.forEach((v, k) => {
      if (k.toLowerCase() === 'set-cookie') {
        const modifiedCookie = v.replace(/Domain=[^;]+;?/gi, "").replace(new RegExp(targetHost, 'g'), myHost);
        res.appendHeader('Set-Cookie', modifiedCookie);
      } else if (k.toLowerCase() !== 'content-encoding') {
        res.setHeader(k, v.replace(new RegExp(targetHost, 'g'), myHost));
      }
    });

    // 4. 处理 301/302 重定向
    if (response.status >= 300 && response.status < 400) {
      const loc = response.headers.get('location');
      if (loc) res.setHeader('Location', loc.replace(targetHost, myHost));
      return res.status(response.status).send('');
    }

    // 5. 内容分发与通知注入
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      let text = await response.text();
      
      // 桌面通知 JS
      const notifyScript = `
      <script>
        (function() {
          // 只有在打勾后（即有了通关 Cookie）才发通知并刷新
          if ("Notification" in window) {
            Notification.requestPermission();
          }
          let hasChecked = false;
          setInterval(() => {
            if (document.cookie.includes('cf_clearance') && !hasChecked) {
              new Notification('漫蛙验证成功', { body: '通关秘钥已就绪，正在进入首页...' });
              hasChecked = true;
              setTimeout(() => { window.location.href = '/'; }, 1500);
            }
          }, 2000);
        })();
      </script>`;

      text = text.replace('</head>', `${notifyScript}</head>`);
      return res.status(response.status).send(text.split(targetHost).join(myHost));
    }

    // 6. 其它资源（图片、脚本、CSS）直接返回
    const buffer = await response.arrayBuffer();
    return res.status(response.status).send(Buffer.from(buffer));

  } catch (err) {
    return res.status(502).send("转发失败: " + err.message);
  }
}
