export default async function handler(req, res) {
  const targetHost = "manwa.me";
  const myHost = req.headers.host;
  const targetUrl = `https://${targetHost}${req.url}`;

  try {
    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": `https://${targetHost}/`,
        "Accept-Language": "zh-CN,zh;q=0.9"
      },
      redirect: "manual"
    });

    // 1. 获取原始响应头
    const newHeaders = new Headers(response.headers);
    
    // 【核心修复】删除所有会阻止验证脚本运行的安全策略
    newHeaders.delete("content-security-policy");
    newHeaders.delete("content-security-policy-report-only");
    newHeaders.delete("x-frame-options");
    newHeaders.delete("clear-site-data");

    // 2. 处理重定向
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location") || "";
      res.setHeader("Location", location.replace(targetHost, myHost));
      return res.status(response.status).send("");
    }

    const contentType = response.headers.get("content-type") || "";

    // 3. 处理网页内容替换
    if (contentType.includes("text/html") || contentType.includes("application/javascript")) {
      let text = await response.text();
      // 把所有漫蛙域名全换成你自己的，确保后续请求不掉队
      text = text.replace(new RegExp(targetHost, 'g'), myHost);
      
      // 把可能存在的其他图片服务器也顺便换了
      text = text.replace(/mwappimgs\.cc/g, myHost);

      // 发送修改后的网页
      res.setHeader("Content-Type", contentType);
      return res.status(200).send(text);
    }

    // 4. 图片等资源直接透传
    const data = await response.arrayBuffer();
    res.setHeader("Content-Type", contentType);
    return res.status(200).send(Buffer.from(data));

  } catch (e) {
    return res.status(200).send("中转站暂时无法连接漫蛙，请刷新试试: " + e.message);
  }
}
