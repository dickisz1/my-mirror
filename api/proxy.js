export default async function handler(req, res) {
  const targetHost = "manwa.me";
  const myHost = req.headers.host;
  
  // 1. 构造请求地址，排除 /proxy-asset/ 的干扰
  const path = req.url.replace('/proxy-asset/manwa.me', '');
  const targetUrl = `https://${targetHost}${path}`;

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        // 伪装成最新的 iPhone 浏览器，这是 Cloudflare 最不容易拦截的身份
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Cookie": req.headers["cookie"] || "",
        "Referer": `https://${targetHost}/`
      },
      redirect: "manual"
    });

    // 2. 这里的重点：原封不动把漫蛙的验证 Cookie 转交给你的浏览器
    const setCookies = response.headers.getSetCookie();
    if (setCookies && setCookies.length > 0) {
      // 抹掉 Domain，让浏览器强行存下这个 Cookie
      res.setHeader("Set-Cookie", setCookies.map(c => c.replace(/Domain=[^;]+;?/gi, "")));
    }

    // 3. 把漫蛙所有的响应头都带回来，但去掉可能导致白屏的 CSP
    response.headers.forEach((v, k) => {
      if (!['content-security-policy', 'content-length', 'transfer-encoding'].includes(k.toLowerCase())) {
        res.setHeader(k, v.replace(new RegExp(targetHost, 'g'), myHost));
      }
    });

    // 4. 处理跳转
    if (response.status >= 300 && response.status < 400) {
      const loc = response.headers.get("location");
      if (loc) res.setHeader("Location", loc.replace(targetHost, myHost));
      return res.status(response.status).send("");
    }

    // 5. 内容替换：只换域名，不改脚本
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/html")) {
      let text = await response.text();
      // 让页面里的链接都走你的域名
      return res.status(response.status).send(text.split(targetHost).join(myHost));
    }

    const buffer = await response.arrayBuffer();
    return res.status(response.status).send(Buffer.from(buffer));

  } catch (e) {
    return res.status(200).send("脚本搬运时卡住了: " + e.message);
  }
}
