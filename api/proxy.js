export default async function handler(req, res) {
  const targetHost = "manwa.me";
  const myHost = req.headers.host;
  const targetUrl = `https://${targetHost}${req.url}`;

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        "Referer": `https://${targetHost}/`,
        "Accept": "*/*",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Cookie": req.headers["cookie"] || "" // 必须把你的验证进度传给漫蛙
      },
      redirect: "manual"
    });

    // 1. 获取所有响应头，并把漫蛙的安全路障全部删掉
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete("content-security-policy");
    responseHeaders.delete("content-security-policy-report-only");
    responseHeaders.delete("x-frame-options");

    // 2. 处理 Cookie (关键：这步决定了验证码能不能点完就过)
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) {
      // 把漫蛙发的身份证换成你的域名，让浏览器能存住它
      const modifiedCookie = setCookie.replace(new RegExp(targetHost, 'g'), myHost);
      res.setHeader("Set-Cookie", modifiedCookie);
    }

    // 3. 处理重定向
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location") || "";
      res.setHeader("Location", location.replace(targetHost, myHost));
      return res.status(response.status).send("");
    }

    const contentType = response.headers.get("content-type") || "";

    // 4. 处理网页内容
    if (contentType.includes("text/html")) {
      let text = await response.text();
      // 把页面上所有的 manwa.me 链接换成你的域名
      text = text.replace(new RegExp(targetHost, 'g'), myHost);
      
      // 强制在页面头部插入一个“放行指令”，让验证码脚本秒出
      const bypassScript = `<meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests">`;
      text = text.replace('<head>', `<head>${bypassScript}`);

      res.setHeader("Content-Type", contentType);
      return res.status(200).send(text);
    }

    // 5. 图片和其他资源直接搬运
    const data = await response.arrayBuffer();
    res.setHeader("Content-Type", contentType);
    return res.status(200).send(Buffer.from(data));

  } catch (e) {
    return res.status(200).send("验证模块初始化失败，请点击刷新: " + e.message);
  }
}
