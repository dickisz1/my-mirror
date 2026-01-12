export default async function handler(req, res) {
  const myHost = req.headers.host;
  let targetUrl;

  // 更加严谨的路径解析
  if (req.url.includes('/proxy-asset/')) {
    // 提取 /proxy-asset/ 之后的所有内容作为目标地址
    const actualPath = req.url.split('/proxy-asset/')[1];
    targetUrl = `https://${actualPath}`;
  } else {
    // 默认访问漫蛙主站
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
    
    // 如果是 HTML 或 JS，执行域名替换
    if (contentType.includes("text/html") || contentType.includes("application/javascript")) {
      let text = await response.text();
      // 这里的替换逻辑要涵盖所有漫蛙域名
      const domains = ["manwa.me", "mwappimgs.cc", "p0.manwa.me", "img.manwa.me"];
      domains.forEach(dom => {
        const regex = new RegExp(dom, 'g');
        text = text.replace(regex, `${myHost}/proxy-asset/${dom}`);
      });
      res.setHeader("Content-Type", contentType);
      return res.status(200).send(text);
    }

    // 图片等资源直接转发
    const buffer = await response.arrayBuffer();
    res.setHeader("Content-Type", contentType);
    return res.status(200).send(Buffer.from(buffer));
  } catch (e) {
    return res.status(500).send("搬运失败: " + e.message);
  }
}
