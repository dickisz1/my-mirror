export default async function handler(req, res) {
  const targetHost = "manwa.me";
  const myHost = req.headers.host;
  const targetUrl = `https://${targetHost}${req.url}`;

  try {
    // 1. 构造发给漫蛙的请求（带上你的原始 Cookie）
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        "User-Agent": req.headers["user-agent"],
        "Referer": `https://${targetHost}/`,
        "Cookie": req.headers["cookie"] || "", // 透传你的身份证给漫蛙
        "Accept": req.headers["accept"],
        "Accept-Language": "zh-CN,zh;q=0.9",
      },
      redirect: "manual"
    });

    // 2. 准备把漫蛙的响应发回给你
    const responseHeaders = new Headers(response.headers);
    
    // 【核心修复】强行把漫蛙发的“身份证”(Set-Cookie) 传回给你的浏览器
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) {
      res.setHeader("Set-Cookie", setCookie.replace(new RegExp(targetHost, 'g'), myHost));
    }

    // 屏蔽安全路障，允许验证脚本运行
    res.setHeader("Content-Security-Policy", "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;");
    res.setHeader("Access-Control-Allow-Origin", "*");

    // 3. 处理重定向
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location") || "";
      res.setHeader("Location", location.replace(targetHost, myHost));
      return res.status(response.status).send("");
    }

    const contentType = response.headers.get("content-type") || "";

    // 4. 处理网页内容替换
    if (contentType.includes("text/html") || contentType.includes("application/javascript")) {
      let text = await response.text();
      // 全量域名替换，确保页面上所有按钮和链接都走你的镜像
      text = text.replace(new RegExp(targetHost, 'g'), myHost);
      text = text.replace(/mwappimgs\.cc/g, myHost);
      
      res.setHeader("Content-Type", contentType);
      return res.status(200).send(text);
    }

    // 5. 图片等资源直接发送
    const data = await response.arrayBuffer();
    res.setHeader("Content-Type", contentType);
    return res.status(200).send(Buffer.from(data));

  } catch (e) {
    return res.status(200).send("验证节点握手失败，请刷新: " + e.message);
  }
}
