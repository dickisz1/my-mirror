export default async function handler(req, res) {
  const SCRAPELESS_API_KEY = "你的_API_KEY"; // 在 scrapeless.com 获取
  const targetUrl = `https://manwa.me${req.url}`;

  // 1. 设置 Scrapeless 浏览器参数
  const payload = {
    browser: "chrome",
    url: targetUrl,
    proxy: "", // 如果你有私域代理可以加上
    wait_for: "networkidle2", // 等待页面加载完成
    antidetect: true, // 开启防检测，这是跳过验证的关键
    headers: req.headers
  };

  try {
    const response = await fetch("https://api.scrapeless.com/v1/browser/fetch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": SCRAPELESS_API_KEY
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    
    // 2. 捕获 Scrapeless 返回的通关 Cookie
    if (result.cookies) {
      result.cookies.forEach(c => {
        res.appendHeader('Set-Cookie', `${c.name}=${c.value}; Path=/; SameSite=Lax`);
      });
    }

    // 3. 注入通知脚本
    if (result.content && result.content.includes('text/html')) {
      let html = result.content;
      
      const notifyScript = `
      <script>
        (function() {
          if (Notification.permission === 'default') Notification.requestPermission();
          // 如果 Scrapeless 已经帮我们拿到了令牌
          if (document.cookie.includes('cf_clearance')) {
             new Notification("🎉 浏览器已代你完成验证！", { body: "正在进入漫蛙首页..." });
             setTimeout(() => { location.href = '/'; }, 1500);
          }
        })();
      </script>`;
      
      html = html.replace('</head>', `${notifyScript}</head>`);
      return res.status(200).send(html.split("manwa.me").join(req.headers.host));
    }

    return res.status(200).send(result.content);

  } catch (err) {
    return res.status(502).send("Scrapeless 连接失败: " + err.message);
  }
}
