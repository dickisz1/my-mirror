export default async function handler(req, res) {
  const myHost = req.headers.host;
  let targetUrl;

  // 1. 识别路径：是首页还是搬运资源？
  if (req.url.includes('/proxy-asset/')) {
    // 提取域名部分。例如从 /proxy-asset/manwa.me/static 提取出 manwa.me/static
    const rawPath = req.url.split('/proxy-asset/')[1];
    targetUrl = `https://${rawPath}`;
  } else {
    targetUrl = `https://manwa.me${req.url}`;
  }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
        "Referer": "https://manwa.me/"
      }
    });

    const contentType = response.headers.get("content-type") || "";

    // 如果是 HTML 或 JS，替换内部链接
    if (contentType.includes("text") || contentType.includes("javascript")) {
      let text = await response.text();
      // 替换逻辑：防止重复替换
      const domains = ["manwa.me", "mwappimgs.cc", "p0.manwa.me"];
      domains.forEach(dom => {
        const regex = new RegExp(`https?://${dom}`, 'g');
        text = text.replace(regex, `https://${myHost}/proxy-asset/${dom}`);
      });
      res.setHeader("Content-Type", contentType);
      return res.status(200).send(text);
    }

    // 图片直接发送
    const arrayBuffer = await response.arrayBuffer();
    res.setHeader("Content-Type", contentType);
    return res.status(200).send(Buffer.from(arrayBuffer));

  } catch (e) {
    // 【关键】这里会把报错信息直接显示在网页上，方便你查错
    return res.status(500).send(`代购在搬运 ${targetUrl} 时滑倒了: ${e.message}`);
  }
}
