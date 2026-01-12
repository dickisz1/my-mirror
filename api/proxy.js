export default async function handler(req, res) {
  const targetHost = "manwa.me";
  const myHost = req.headers.host;

  // 1. 拼接目标地址：你要什么，我就去漫蛙抓什么
  const targetUrl = `https://${targetHost}${req.url}`;

  try {
    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
        "Referer": `https://${targetHost}/`
      },
      redirect: "manual"
    });

    // 2. 处理漫蛙的“踢人”跳转（302），强行改回你自己的域名
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location") || "";
      const newLocation = location.replace(targetHost, myHost);
      res.setHeader("Location", newLocation);
      return res.status(response.status).send("");
    }

    const contentType = response.headers.get("content-type") || "";

    // 3. 如果是网页内容，把里面的“manwa.me”全换成“你的域名”
    if (contentType.includes("text/html") || contentType.includes("application/javascript")) {
      let text = await response.text();
      // 核心替换逻辑：让网页里的所有链接都指向你自己
      const regex = new RegExp(targetHost, 'g');
      text = text.replace(regex, myHost);
      
      res.setHeader("Content-Type", contentType);
      return res.status(200).send(text);
    }

    // 4. 图片等资源直接原样吐出
    const data = await response.arrayBuffer();
    res.setHeader("Content-Type", contentType);
    return res.status(200).send(Buffer.from(data));

  } catch (e) {
    // 如果报错，直接把错误显示出来，不报 500
    return res.status(200).send("连接漫蛙失败，原因: " + e.message);
  }
}
