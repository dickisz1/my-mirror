export default async function handler(req, res) {
  const targetHost = "manwa.me";
  const myHost = req.headers.host;
  const url = `https://${targetHost}${req.url}`;

  const requestHeaders = {};
  const headersToCopy = [
    'user-agent', 'accept', 'accept-language', 'cookie', 
    'referer', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform'
  ];
  
  headersToCopy.forEach(h => {
    if (req.headers[h]) {
      // 关键：请求时把你的域名换回漫蛙域名，否则漫蛙不认
      requestHeaders[h] = req.headers[h].split(myHost).join(targetHost);
    }
  });

  try {
    const response = await fetch(url, {
      method: req.method,
      headers: requestHeaders,
      redirect: 'manual'
    });

    // 1. 深度处理响应头
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') {
        // 【最关键一步】把漫蛙发回的所有 Cookie 全部强行改写为你的域名
        // 这样你的浏览器才会乖乖存下“通关令牌”
        const modifiedCookie = value.replace(/Domain=[^;]+;?/gi, `Domain=${myHost};`)
                                    .replace(/manwa\.me/g, myHost);
        res.setHeader('Set-Cookie', modifiedCookie);
      } else if (key.toLowerCase() !== 'content-encoding' && key.toLowerCase() !== 'content-length') {
        res.setHeader(key, value.replace(new RegExp(targetHost, 'g'), myHost));
      }
    });

    // 2. 处理验证通过后的自动跳转
    if (response.status >= 300 && response.status < 400) {
      const loc = response.headers.get('location');
      if (loc) res.setHeader('Location', loc.replace(targetHost, myHost));
      return res.status(response.status).send('');
    }

    // 3. 网页内容替换
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      let text = await response.text();
      // 移除可能干扰验证跳转的安全策略
      text = text.replace(/<meta[^>]*content-security-policy[^>]*>/gi, '');
      return res.status(response.status).send(text.split(targetHost).join(myHost));
    }

    const buffer = await response.arrayBuffer();
    return res.status(response.status).send(Buffer.from(buffer));

  } catch (err) {
    return res.status(502).send("令牌同步异常: " + err.message);
  }
}
