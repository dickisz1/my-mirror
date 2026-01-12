export default async function handler(req, res) {
  const targetHost = "manwa.me";
  const myHost = req.headers.host;
  
  // 1. 验证码零件直通：这是让“勾选框”跳出来的核心
  if (req.url.includes('cdn-cgi/')) {
    const cfUrl = `https://${targetHost}${req.url}`;
    const cfRes = await fetch(cfUrl);
    const cfData = await cfRes.arrayBuffer();
    res.setHeader("Content-Type", cfRes.headers.get("content-type"));
    return res.status(200).send(Buffer.from(cfData));
  }

  const targetUrl = `https://${targetHost}${req.url}`;

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": `https://${targetHost}/`,
        "Cookie": req.headers["cookie"] || "",
        "Accept-Language": "zh-CN,zh;q=0.9",
      },
      redirect: "manual"
    });

    // 2. 存下令牌：这是让你“打勾后能进去”的关键
    const setCookies = response.headers.getSetCookie();
    if (setCookies && setCookies.length > 0) {
      // 强行把漫蛙发的通关令牌绑在你的域名上
      res.setHeader("Set-Cookie", setCookies.map(c => 
        c.replace(/manwa\.me/g, myHost).replace(/Domain=[^;]+;?/gi, "")
      ));
    }

    // 3. 处理跳转
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location") || "";
      res.setHeader("Location", location.replace(targetHost, myHost));
      return res.status(response.status).send("");
    }

    const contentType = response.headers.get("content-type") || "";

    // 4. 网页域名替换
    if (contentType.includes("text/html")) {
      let text = await response.text();
      // 让网页里所有按钮都指向你自己
      text = text.split(targetHost).join(myHost);
      
      res.setHeader("Content-Type", contentType);
      // 允许验证脚本运行
      res.setHeader("Content-Security-Policy", "upgrade-insecure-requests");
      return res.status(200).send(text);
    }

    // 5. 图片等资源
    const data = await response.arrayBuffer();
    res.setHeader("Content-Type", contentType);
    return res.status(200).send(Buffer.from(data));

  } catch (e) {
    return res.status(200).send("验证节点握手失败，请刷新: " + e.message);
  }
}
