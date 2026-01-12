export default async function handler(req, res) {
  const targetHost = "manwa.me";
  const myHost = req.headers.host;
  const url = `https://${targetHost}${req.url}`;

  // 1. 极致透明：除了 host，其他的头一个都不改，全部照搬
  const requestHeaders = {};
  Object.keys(req.headers).forEach(key => {
    requestHeaders[key] = req.headers[key].toString().split(myHost).join(targetHost);
  });

  try {
    const response = await fetch(url, {
      method: req.method,
      headers: requestHeaders,
      redirect: 'manual'
    });

    // 2. 拿到响应后，把漫蛙的头全给用户，只改域名
    response.headers.forEach((v, k) => {
      res.setHeader(k, v.split(targetHost).join(myHost));
    });

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      let text = await response.text();
      
      // 3. 注入你要的桌面通知
      const script = `
      <script>
        if (Notification.permission === 'default') Notification.requestPermission();
        setInterval(() => {
          if (document.cookie.includes('cf_clearance') && !window.done) {
            new Notification('通关成功！', { body: '已获取秘钥，正在进入...' });
            window.done = true;
            setTimeout(() => location.reload(), 2000);
          }
        }, 2000);
      </script>`;
      
      return res.send(text.replace('</head>', script + '</head>').split(targetHost).join(myHost));
    }

    const buffer = await response.arrayBuffer();
    return res.status(response.status).send(Buffer.from(buffer));
  } catch (e) {
    return res.status(500).send(e.message);
  }
}
