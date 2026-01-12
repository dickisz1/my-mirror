export default async function handler(req, res) {
  const myHost = req.headers.host;
  const targetHost = "manwa.me";
  
  // 1. 自动计算要搬运的目标地址
  let targetUrl;
  if (req.url.startsWith('/proxy-asset/')) {
    // 处理图片等外部资源: /proxy-asset/mwappimgs.cc/xxx -> https://mwappimgs.cc/xxx
    targetUrl = 'https://' + req.url.replace('/proxy-asset/', '');
  } else {
    // 处理主站内容: /abc -> https://manwa.me/abc
    targetUrl = `https://${targetHost}${req.url}`;
  }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1",
        "Referer": `https://${targetHost}/`
      },
      redirect: "manual" // 拦截重定向，不让它跳回原站
    });

    // 处理重定向 (301/302)，强行留在大本营
    if (response.status >= 300 && response.status < 400) {
      let location = response.headers.get("location") || "";
      location = location.replace(/https?:\/\/(manwa\.me|mwappimgs\.cc|p0\.manwa\.me)/g, `https://${myHost}`);
      res.setHeader("Location", location);
      return res.status(response.status).send("");
    }

    const contentType = response.headers.get("content-type") || "";
    
    // 2. 如果是网页或脚本，就把里面的所有漫蛙域名换成我们自己的“搬运路径”
    if (contentType.includes("text") || contentType.includes("javascript")) {
      let text = await response.text();
      const domains = ["manwa.me", "mwappimgs.cc", "p0.manwa.me", "img.manwa.me", "cdn.manwa.me"];
      
      domains.forEach(dom => {
        const regex = new RegExp(dom, 'g');
        text = text.replace(regex, `${myHost}/proxy-asset/${dom}`);
      });

      // 额外修复：把相对路径的验证码请求也拉进来
      text = text.replace(/\/cdn-cgi\//g, `https://${myHost}/proxy-asset/${targetHost}/cdn-cgi/`);

      res.setHeader("Content-Type", contentType);
      return res.status(200).send(text);
    }

    // 3. 图片、CSS等二进制资源直接原样输出
    const data = await response.arrayBuffer();
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=31536000"); // 缓存图片，下次秒开
    return res.status(200).send(Buffer.from(data));

  } catch (e) {
    return res.status(500).send("搬运工滑倒了: " + e.message);
  }
}
