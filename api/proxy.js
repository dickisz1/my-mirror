export default async function handler(req, res) {
  const targetHost = "manwa.me";
  const myHost = req.headers.host;
  const url = `https://${targetHost}${req.url}`;

  // 1. 完美克隆你的浏览器指纹，不留痕迹
  const requestHeaders = {};
  Object.keys(req.headers).forEach(key => {
    // 关键：把请求头里所有的“你自己域名”换回“漫蛙域名”，欺骗防火墙
    requestHeaders[key] = req.headers[key].toString().split(myHost).join(targetHost);
  });

  try {
    const response = await fetch(url, {
      method: req.method,
      headers: requestHeaders,
      redirect: 'manual'
    });

    // 2. 拿到漫蛙的所有响应头，原封不动传回
    response.headers.forEach((v, k) => {
      // 必须把 Set-Cookie 里的域名修正，浏览器才会存通关令牌
      if (k.toLowerCase() === 'set-cookie') {
        res.appendHeader('Set-Cookie', v.replace(/manwa\.me/g, myHost).replace(/Domain=[^;]+;?/gi, ""));
      } else if (k.toLowerCase() !== 'content-encoding') {
        res.setHeader(k, v.replace(new RegExp(targetHost, 'g'), myHost));
      }
    });

    // 3. 处理验证后的跳转
    if (response.status >= 300 && response.status < 400) {
      const loc = response.headers.get('location');
      if (loc) res.setHeader('Location', loc.replace(targetHost, myHost));
      return res.status(response.status).send('');
    }

    // 4. 只对 HTML 页面做域名替换，保证图片和验证脚本原样运行
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      let text = await response.text();
      return res.status(response.status).send(text.split(targetHost).join(myHost));
    }

    // 5. 转发所有二进制流（验证码零件、图片）
    const buffer = await response.arrayBuffer();
    return res.status(response.status).send(Buffer.from(buffer));

  } catch (err) {
    // 如果报错，直接显示具体原因
    return res.status(200).send(`代连失败，可能是漫蛙暂时封锁了IP: ${err.message}`);
  }
}
