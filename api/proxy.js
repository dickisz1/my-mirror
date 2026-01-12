export default async function handler(req, res) {
  const targetHost = "manwa.me";
  const myHost = req.headers.host;
  
  // 1. 自动处理请求路径，支持直接访问根目录
  const path = req.url === '/' ? '' : req.url;
  const targetUrl = `https://${targetHost}${path}`;

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        // 使用更具迷惑性的移动端 User-Agent
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh-TW;q=0.9,en-US;q=0.8,en;q=0.7",
        "Referer": `https://www.google.com/`, // 伪装成从搜索引擎跳转过来
        "Cookie": req.headers["cookie"] || "",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "cross-site"
      },
      redirect: "manual"
    });

    // 2. 检查漫蛙是否返回了 403
    if (response.status === 403) {
      return res.status(403).send("当前 Vercel 节点仍被漫蛙拒绝。请确保你已在 Vercel 后台将 Function Region 更换为新加坡或香港，并执行了 Redeploy。");
    }

    // 3. 同步通关令牌 (Cookie)
    const setCookies = response.headers.getSetCookie();
    if (setCookies.length > 0) {
      res.setHeader("Set-Cookie", setCookies.map(c => c.replace(/manwa\.me/g, myHost).replace(/Domain=[^;]+;?/gi, "")));
    }

    // 4. 处理内容替换
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/html")) {
      let text = await response.text();
      // 全局域名转换
      text = text.split(targetHost).join(myHost);
      res.setHeader("Content-Type", contentType);
      return res.status(response.status).send(text);
    }

    // 5. 转发图片等其他资源
    const buffer = await response.arrayBuffer();
    res.setHeader("Content-Type", contentType);
    return res.status(response.status).send(Buffer.from(buffer));

  } catch (e) {
    return res.status(502).send("连接失败，请检查漫蛙主站是否在线: " + e.message);
  }
}
