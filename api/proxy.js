export default async function handler(req, res) {
  const targetHost = "manwa.me";
  const myHost = req.headers.host;
  const targetUrl = `https://${targetHost}${req.url}`;

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        "User-Agent": req.headers["user-agent"],
        "Cookie": req.headers["cookie"] || "",
        "Referer": `https://${targetHost}/`,
        "Accept": req.headers["accept"],
        "Accept-Language": "zh-CN,zh;q=0.9"
      },
      redirect: "manual"
    });

    // 1. 传递所有 Cookie，且不做域名强制锁定
    const setCookies = response.headers.getSetCookie();
    if (setCookies.length > 0) {
      res.setHeader("Set-Cookie", setCookies.map(c => c.replace(/Domain=[^;]+;?/gi, "")));
    }

    // 2. 移除所有安全限制头，让验证码脚本自由运行
    response.headers.forEach((v, k) => {
      if (!['content-security-policy', 'content-length', 'transfer-encoding'].includes(k.toLowerCase())) {
        res.setHeader(k, v.replace(new RegExp(targetHost, 'g'), myHost));
      }
    });

    // 3. 处理跳转
    if (response.status >= 300 && response.status < 400) {
      const loc = response.headers.get("location");
      return res.status(response.status).setHeader("Location", loc.replace(targetHost, myHost)).send("");
    }

    // 4. 网页内容：极致简化的域名全局替换
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/html")) {
      const text = await response.text();
      res.setHeader("Content-Type", contentType);
      return res.status(response.status).send(text.split(targetHost).join(myHost));
    }

    // 5. 其他二进制流
    const buffer = await response.arrayBuffer();
    return res.status(response.status).send(Buffer.from(buffer));

  } catch (e) {
    return res.status(500).send("连接中断，请重试: " + e.message);
  }
}
