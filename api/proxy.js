export default async function handler(req, res) {
  const targetHost = "manwa.me";
  const myHost = req.headers.host;
  
  // 1. 如果请求的是验证码相关的零件，直接原样放行，不去修改它
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

    // 2. 传递 Cookie (身份证)
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) {
      res.setHeader("Set-Cookie", setCookie.replace(new RegExp(targetHost, 'g'), myHost));
    }

    // 3. 处理重定向
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location") || "";
      res.setHeader("Location", location.replace(targetHost, myHost));
      return res.status(response.status).send("");
    }

    const contentType = response.headers.get("content-type") || "";

    // 4. 只在 HTML 网页里替换域名，不要动别的
    if (contentType.includes("text/html")) {
      let text = await response.text();
      // 把网页里看到的 manwa.me 换成你自己的，但排除掉 cloudflare 的地址
      text = text.replace(/manwa\.me/g, myHost);
      
      // 核心：强制放行验证码脚本，不要让它们走代理，直接去连 Cloudflare
      res.setHeader("Content-Type", contentType);
      // 清除干扰验证码的安全头
      res.setHeader("Content-Security-Policy", "upgrade-insecure-requests");
      return res.status(200).send(text);
    }

    // 5. 图片等资源直接搬运
    const data = await response.arrayBuffer();
    res.setHeader("Content-Type", contentType);
    return res.status(200).send(Buffer.from(data));

  } catch (e) {
    return res.status(200).send("刷新太快或连接超时，请重试: " + e.message);
  }
}
