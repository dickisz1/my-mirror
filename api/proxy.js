export default async function handler(req, res) {
  const targetHost = "manwa.me";
  const myHost = req.headers.host;
  const url = `https://${targetHost}${req.url}`;

  // 1. 极其重要的头信息：直接照搬你的浏览器头
  const requestHeaders = {};
  const headersToCopy = [
    'user-agent', 'accept', 'accept-language', 'cookie', 
    'referer', 'priority', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform'
  ];
  
  headersToCopy.forEach(h => {
    if (req.headers[h]) {
      requestHeaders[h] = req.headers[h].split(myHost).join(targetHost);
    }
  });

  try {
    const response = await fetch(url, {
      method: req.method,
      headers: requestHeaders,
      body: (req.method !== 'GET' && req.method !== 'HEAD') ? JSON.stringify(req.body) : undefined,
      redirect: 'manual'
    });

    // 2. 响应头处理：【修正通关秘钥】
    response.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      if (lowerKey === 'content-encoding') return;

      if (lowerKey === 'set-cookie') {
        // 抹掉 Domain 限制，让 dickisz123.dpdns.org 强行存下验证通过的秘钥
        const modifiedCookie = value
          .replace(/Domain=[^;]+;?/gi, "") 
          .replace(new RegExp(targetHost, 'g'), myHost);
        res.appendHeader('Set-Cookie', modifiedCookie);
      } else {
        res.setHeader(key, value.replace(new RegExp(targetHost, 'g'), myHost));
      }
    });

    // 3. 处理重定向
    if (response.status >= 300 && response.status < 400) {
      const loc = response.headers.get('location');
      if (loc) res.setHeader('Location', loc.replace(targetHost, myHost));
      return res.status(response.status).send('');
    }

    // 4. 内容处理：【增加验证码保护逻辑】
    const contentType = response.headers.get('content-type') || '';
    
    // 如果是验证码的关键零件（cdn-cgi），直接原样返回，不准替换字符！
    if (req.url.includes('cdn-cgi/')) {
      const buffer = await response.arrayBuffer();
      return res.status(response.status).send(Buffer.from(buffer));
    }

    if (contentType.includes('text/html')) {
      let text = await response.text();
      // 仅替换网页中的链接，不破坏脚本逻辑
      return res.status(response.status).send(text.split(targetHost).join(myHost));
    }

    // 5. 其他所有东西原样转发
    const buffer = await response.arrayBuffer();
    return res.status(response.status).send(Buffer.from(buffer));

  } catch (err) {
    return res.status(502).send("脚本代连异常: " + err.message);
  }
}
