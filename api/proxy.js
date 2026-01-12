export default async function handler(req, res) {
  const target = "manwa.me";
  const myHost = req.headers.host;

  // 定义所有需要中转的漫蛙域名（包括你截图里的脚本域名）
  const domainsToProxy = [
    "manwa.me",
    "mwappimgs.cc",
    "p0.manwa.me",
    "img.manwa.me",
    "cdn.manwa.me"
    "challenges.cloudflare.com" // 强制代理验证码脚本，确保国内直连能过验证
  ];

  let targetUrl;
  if (req.url.startsWith('/proxy-asset/')) {
    // 提取真实地址：/proxy-asset/mwappimgs.cc/xxx -> https://mwappimgs.cc/xxx
    targetUrl = 'https://' + req.url.replace('/proxy-asset/', '');
  } else {
    targetUrl = `https://${target}${req.url}`;
  }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
        "Referer": `https://${target}/`,
      },
      redirect: "manual" // 【核心修复 1】禁止自动跳转，由我们接管跳转逻辑
    });

    // 处理 302 重定向：防止被踢回原站
    if (response.status >= 300 && response.status < 400) {
      let location = response.headers.get("location");
      if (location) {
        // 如果重定向到漫蛙域名，强行改回我们的镜像域名
        location = location.replace(/https?:\/\/(manwa\.me|mwappimgs\.cc)/, `https://${myHost}`);
        res.setHeader("Location", location);
        return res.status(response.status).send("");
      }
    }

    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("text/html") || contentType.includes("application/javascript")) {
      let text = await response.text();
      
      // 【核心修复 2】全量替换域名：把网页和脚本里的所有漫蛙域名都通过我们的 /proxy-asset/ 中转
      domainsToProxy.forEach(dom => {
        const regex = new RegExp(dom, 'g');
        text = text.replace(regex, `${myHost}/proxy-asset/${dom}`);
      });

      res.setHeader("Content-Type", contentType);
      return res.status(200).send(text);
    }

    // 图片等二进制资源
    const data = await response.arrayBuffer();
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000");
    return res.status(200).send(Buffer.from(data));

  } catch (e) {
    return res.status(500).send("中转站连接失败: " + e.message);
  }
}
