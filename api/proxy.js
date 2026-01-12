export default async function handler(req, res) {
  const myHost = req.headers.host;
  const target = "manwa.me";
  let targetUrl;

  // 1. 极简路径解析：不再依赖复杂的判断
  if (req.url.startsWith('/proxy-asset/')) {
    targetUrl = 'https://' + req.url.replace('/proxy-asset/', '');
  } else {
    // 确保访问根目录时直接指向漫蛙主站
    targetUrl = `https://${target}${req.url}`;
  }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
        "Referer": `https://${target}/`
      },
      redirect: "manual" // 拦截所有 302 跳转
    });

    const contentType = response.headers.get("content-type") || "";

    // 2. 针对 HTML 和 JS 的深度清洗
    if (contentType.includes("text/html") || contentType.includes("application/javascript")) {
      let text = await response.text();
      
      // 替换所有已知的漫蛙域名及其资源域名
      const domains = ["manwa.me", "mwappimgs.cc", "p0.manwa.me", "img.manwa.me"];
      domains.forEach(dom => {
        // 使用正则确保只替换真实的域名，不误伤路径
        const regex = new RegExp(`https?://${dom}`, 'g');
        text = text.replace(regex, `https://${myHost}/proxy-asset/${dom}`);
      });

      // 【核心修复】强行把 Cloudflare 的相对路径也拉入代理
      text = text.replace(/\/cdn-cgi\//g, `https://${myHost}/proxy-asset/${target}/cdn-cgi/`);

      res.setHeader("Content-Type", contentType);
      return res.status(200).send(text);
    }

    // 3. 图片等二进制资源直接返回
    const data = await response.arrayBuffer();
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000"); // 缓存图片，加快国内加载
    return res.status(200).send(Buffer.from(data));

  } catch (e) {
    console.error(e);
    return res.status(500).send("中转失败，请刷新重试: " + e.message);
  }
}
