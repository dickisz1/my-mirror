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

    if (req.headers[h]) requestHeaders[h] = req.headers[h].replace(myHost, targetHost);

  });



  try {

    const response = await fetch(url, {

      method: req.method,

      headers: requestHeaders,

      body: req.method !== 'GET' && req.method !== 'HEAD' ? await req.body : undefined,

      redirect: 'manual'

    });



    // 2. 拿到漫蛙的所有响应头，原封不动地传回给你

    response.headers.forEach((value, key) => {

      // 排除掉可能导致死循环的压缩头

      if (key !== 'content-encoding') {

        res.setHeader(key, value.replace(new RegExp(targetHost, 'g'), myHost));

      }

    });



    // 3. 处理重定向

    if (response.status >= 300 && response.status < 400) {

      const loc = response.headers.get('location');

      if (loc) res.setHeader('Location', loc.replace(targetHost, myHost));

      return res.status(response.status).send('');

    }



    // 4. 内容处理：如果是网页，只做最基础的域名替换

    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('text/html')) {

      let text = await response.text();

      // 关键：把页面上所有的 manwa.me 变成你的域名，让接下来的请求还能回到 Vercel

      return res.status(response.status).send(text.split(targetHost).join(myHost));

    }



    // 5. 其他所有东西（图片、脚本、验证码零件）全部原样转发

    const buffer = await response.arrayBuffer();

    return res.status(response.status).send(Buffer.from(buffer));



  } catch (err) {

    return res.status(502).send("脚本代连异常: " + err.message);

  }

} 
