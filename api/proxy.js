export default async function handler(req, res) {
  const targetHost = "manwa.me";
  const myHost = req.headers.host;
  
  // 1. 如果请求的是验证码零件，直接原样放行，不改动任何代码
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
        // 维持这个稳定的 UA 身份
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": `https://${targetHost}/`,
        "Cookie": req.headers["cookie"] || "",
        "Accept-Language": "zh-CN,zh;q=0.9",
      },
      redirect: "manual"
    });

    // 2. 传递 Cookie (通关用的身份证)
    const setCookies = response.headers.getSetCookie();
    if (setCookies && setCookies.length > 0) {
      res.setHeader("Set-Cookie", setCookies.map(c => c.replace(/manwa\.me/g, myHost).replace(/Domain=[^;]+;?/gi, "")));
    }

    // 3. 处理重定向
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location") || "";
      res.setHeader("Location", location.replace(targetHost, myHost));
      return res.status(response.status).send("");
    }

    const contentType = response.headers.get("content-type") || "";

    // 4. 只在 HTML 网页里替换域名，不要动别的脚本逻辑
    if (contentType.includes("text/html")) {
      let text = await response.text();
      text = text.replace(/manwa\.me/g, myHost);
      
      res.setHeader("Content-Type", contentType);
      // 允许验证码加载的关键头
      res.setHeader("Content-Security-Policy", "upgrade-insecure-requests");
      return res.status(200).send(text);
    }

    // 5. 图片等资源直接搬运
    const data = await response.arrayBuffer();
    res.setHeader("Content-Type", contentType);
    return res.status(200).send(Buffer.from(data));

  } catch (e) {
    return res.status(200).send("刷新太快，请稍后重试: " + e.message);
  }
}
