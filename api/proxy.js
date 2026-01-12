export default async function handler(req, res) {
  const targetHost = "manwa.me";
  const myHost = req.headers.host;
  const targetUrl = `https://${targetHost}${req.url}`;

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Referer": `https://${targetHost}/`,
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none", // 伪装成直接输入网址访问
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
        "Cookie": req.headers["cookie"] || ""
      },
      redirect: "manual"
    });

    // 如果还是返回 403，说明 IP 真的被卡死了
    if (response.status === 403) {
      return res.status(403).send("漫蛙服务器拒绝了 Vercel 的访问。建议等待一小时后更换路径重试，或检查漫蛙主站是否开启了极高强度的盾。");
    }

    // 处理 Set-Cookie，确保通关令牌能存下
    const setCookies = response.headers.getSetCookie();
    if (setCookies.length > 0) {
      res.setHeader("Set-Cookie", setCookies.map(c => c.replace(/manwa\.me/g, myHost).replace(/Domain=[^;]+;?/gi, "")));
    }

    // 网页内容替换
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/html")) {
      let text = await response.text();
      res.setHeader("Content-Type", contentType);
      return res.status(response.status).send(text.split(targetHost).join(myHost));
    }

    // 转发资源
    const buffer = await response.arrayBuffer();
    res.setHeader("Content-Type", contentType);
    return res.status(response.status).send(Buffer.from(buffer));

  } catch (e) {
    return res.status(502).send("连接异常: " + e.message);
  }
}
