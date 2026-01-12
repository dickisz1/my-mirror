export default async function handler(req, res) {
  const targetHost = "manwa.me";
  const myHost = req.headers.host;
  const url = `https://${targetHost}${req.url}`;

  // 1. 1:1 还原所有头信息，不漏掉任何指纹
  const requestHeaders = {};
  Object.keys(req.headers).forEach(key => {
    // 关键：除了 host，其余全部照搬
    if (key.toLowerCase() !== 'host') {
      requestHeaders[key] = req.headers[key].toString().replace(new RegExp(myHost, 'g'), targetHost);
    }
  });

  try {
    const response = await fetch(url, {
      method: req.method,
      headers: requestHeaders,
      redirect: 'manual'
    });

    // 2. 响应头全量转发，解决“白屏”问题
    response.headers.forEach((v, k) => {
      // 排除掉压缩头，交给 Vercel 处理，防止乱码
      if (k.toLowerCase() !== 'content-encoding') {
        res.setHeader(k, v.replace(new RegExp(targetHost, 'g'), myHost));
      }
    });

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      let text = await response.text();
      
      // 3. 注入【自动检测通关】脚本
      // 只要打勾成功拿到秘钥，立即发通知并带你进站
      const passScript = `
      <script>
        (function() {
          // 预请求权限
          if (Notification.permission === "default") Notification.requestPermission();

          let checkCount = 0;
          const timer = setInterval(() => {
            if (document.cookie.includes("cf_clearance")) {
              new Notification("🎉 验证已通过！", { body: "正在为您跳转至漫蛙首页..." });
              clearInterval(timer);
              setTimeout(() => { location.href = '/'; }, 1000);
            }
            // 如果 10 秒还没过，尝试自动刷新页面重试
            if (++checkCount > 10) { 
              console.log("正在重试验证加载..."); 
            }
          }, 1500);
        })();
      </script>`;

      text = text.replace('</head>', `${passScript}</head>`);
      return res.status(response.status).send(text.split(targetHost).join(myHost));
    }

    const buffer = await response.arrayBuffer();
    return res.status(response.status).send(Buffer.from(buffer));

  } catch (err) {
    return res.status(502).send("连接超时，请刷新重试");
  }
}
