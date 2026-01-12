export default async function handler(req, res) {
  const target = "manwa.me";
  const myHost = req.headers.host;

  // 必须中转的域名列表
  const domainsToProxy = ["manwa.me", "mwappimgs.cc", "p0.manwa.me", "img.manwa.me", "cdn.manwa.me"];

  let targetUrl;
  // 修正：确保路径解析不会出错
  if (req.url.startsWith('/proxy-asset/')) {
    targetUrl = 'https://' + req.url.replace('/proxy-asset/', '');
  } else {
    targetUrl = `https://${target}${req.url}`;
  }

  try {
    // 设置 8 秒超时，防止函数崩溃
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
        "Referer": `https://${target}/`,
      },
      redirect: "manual",
      signal: controller.signal
    });

    clearTimeout(timeout);

    // 处理重定向
    if (response.status >= 300 && response.status < 400) {
      let location = response.headers.get("location");
      if (location) {
        location = location.replace(/https?:\/\/(manwa\.me|mwappimgs\.cc)/g, `https://${myHost}`);
        res.setHeader("Location", location);
        return res.status(response.status).send("");
      }
    }

    const contentType = response.headers.get("content-type") || "";

    // 处理文本资源 (HTML/JS)
    if (contentType.includes("text") || contentType.includes("javascript")) {
      let text = await response.text();
      domainsToProxy.forEach(dom => {
        const regex = new RegExp(dom, 'g');
        text = text.replace(regex, `${myHost}/proxy-asset/${dom}`);
      });
      res.setHeader("Content-Type", contentType);
      return res.status(200).send(text);
    }

    // 处理二进制资源 (图片)
    const blob = await response.arrayBuffer();
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000");
    // 使用新的 Uint8Array 方式处理，兼容性更好
    return res.status(200).send(Buffer.from(blob));

  } catch (e) {
    console.error("Proxy Error:", e.message);
    return res.status(500).json({ error: "搬运工累倒了", msg: e.message });
  }
}
