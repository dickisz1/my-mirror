export default async function handler(req, res) {
  const targetHost = "manwa.me";
  const myHost = req.headers.host;
  const url = `https://${targetHost}${req.url}`;

  const requestHeaders = {};
  const headersToCopy = ['user-agent', 'accept', 'accept-language', 'cookie', 'referer', 'priority', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform'];
  
  headersToCopy.forEach(h => {
    if (req.headers[h]) requestHeaders[h] = req.headers[h].split(myHost).join(targetHost);
  });

  try {
    const response = await fetch(url, {
      method: req.method,
      headers: requestHeaders,
      body: (req.method !== 'GET' && req.method !== 'HEAD') ? JSON.stringify(req.body) : undefined,
      redirect: 'manual'
    });

    // 处理响应头：精准同步通关秘钥
    response.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      if (lowerKey === 'content-encoding') return;

      if (lowerKey === 'set-cookie') {
        // 抹掉 Domain 限制，解决浏览器拒收秘钥的问题
        const modifiedCookie = value
          .replace(/Domain=[^;]+;?/gi, "") 
          .replace(new RegExp(targetHost, 'g'), myHost);
        res.appendHeader('Set-Cookie', modifiedCookie);
      } else {
        res.setHeader(key, value.replace(new RegExp(targetHost, 'g'), myHost));
      }
    });

    // 重点：如果请求的是验证码核心路径，直接原样转发，不准 split/join！
    if (req.url.includes('cdn-cgi/')) {
      const buffer = await response.arrayBuffer();
      return res.status(response.status).send(Buffer.from(buffer));
    }

    if (response.status >= 300 && response.status < 400) {
      const loc = response.headers.get('location');
      if (loc) res.setHeader('Location', loc.replace(targetHost, myHost));
      return res.status(response.status).send('');
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      let text = await response.text();
      return res.status(response.status).send(text.split(targetHost).join(myHost));
    }

    const buffer = await response.arrayBuffer();
    return res.status(response.status).send(Buffer.from(buffer));

  } catch (err) {
    return res.status(502).send("脚本代连异常: " + err.message);
  }
}
