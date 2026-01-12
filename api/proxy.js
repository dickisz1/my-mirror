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
      // 请求时把你的域名换回漫蛙域名，骗过防火墙
      requestHeaders[h] = req.headers[h].split(myHost).join(targetHost);
    }
  });

  try {
    const response = await fetch(url, {
      method: req.method,
      headers: requestHeaders,
      // 注意：Vercel 环境下 body 处理需要小心，通常 GET 请求不传 body
      body: (req.method !== 'GET' && req.method !== 'HEAD') ? JSON.stringify(req.body) : undefined,
      redirect: 'manual'
    });

    // 2. 响应头处理：【通关秘钥补丁就在这里】
    response.headers.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      // 排除压缩头防止白屏
      if (lowerKey === 'content-encoding') return;

      if (lowerKey === 'set-cookie') {
        // 核心修改：移除 Domain 属性，并把漫蛙域名替换成你的域名
        // 这样浏览器才会把“通关秘钥”存入 dickisz123.dpdns.org
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

    // 4. 内容处理
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      let text = await response.text();
      // 全局域名替换，确保页面资源请求全部回到我们的代理
      return res.status(response.status).send(text.split(targetHost).join(myHost));
    }

    // 5. 其他所有资源原样转发
    const buffer = await response.arrayBuffer();
    return res.status(response.status).send(Buffer.from(buffer));

  } catch (err) {
    return res.status(502).send("脚本代连异常: " + err.message);
  }
}
