export default async function handler(req, res) {
  const targetHost = "manwa.me";
  const myHost = req.headers.host;
  const url = `https://${targetHost}${req.url}`;

  const requestHeaders = {};
  const headersToCopy = ['user-agent', 'accept', 'accept-language', 'cookie', 'referer', 'content-type'];
  headersToCopy.forEach(h => {
    if (req.headers[h]) requestHeaders[h] = req.headers[h].split(myHost).join(targetHost);
  });

  try {
    const response = await fetch(url, {
      method: req.method,
      headers: requestHeaders,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
      redirect: 'manual'
    });

    const setCookies = response.headers.getSetCookie();
    let debugInfo = ""; // 记录 Cookie 捕获情况

    if (setCookies.length > 0) {
      setCookies.forEach(cookie => {
        if (cookie.includes("cf_clearance")) debugInfo = "FOUND_CF";
        const cleanCookie = cookie
          .replace(/Domain=[^;]+;?/gi, "") 
          .replace(/Path=[^;]+;?/gi, "Path=/;")
          .replace(/SameSite=None/gi, "SameSite=Lax")
          .replace(/Secure/gi, "")
          .split(targetHost).join(myHost);
        res.appendHeader('Set-Cookie', cleanCookie);
      });
    }

    // 复制响应头
    response.headers.forEach((v, k) => {
      if (!['set-cookie', 'content-encoding', 'content-length'].includes(k.toLowerCase())) {
        res.setHeader(k, v.replace(new RegExp(targetHost, 'g'), myHost));
      }
    });

    if (response.status >= 300 && response.status < 400) {
      const loc = response.headers.get('location');
      if (loc) res.setHeader('Location', loc.replace(targetHost, myHost));
      return res.status(response.status).send('');
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      let text = await response.text();
      
      // 注入【无感知反馈脚本】
      const feedbackScript = `
      <script>
        (function() {
          const statusDiv = document.createElement('div');
          statusDiv.style = "position:fixed;bottom:20px;right:20px;background:rgba(0,0,0,0.8);color:white;padding:15px;z-index:100000;font-family:monospace;font-size:12px;max-width:300px;word-break:break-all;";
          document.body.appendChild(statusDiv);

          setInterval(() => {
            const hasCF = document.cookie.includes("cf_clearance");
            const allCookies = document.cookie.split(';').map(c => c.split('=')[0].trim());
            statusDiv.innerHTML = "<b>反馈报告:</b><br>" +
                                  "CF秘钥: " + (hasCF ? "✅已就绪" : "❌未找到") + "<br>" +
                                  "当前Cookie名: " + allCookies.join(', ') + "<br>" +
                                  "后端检测: ${debugInfo || '无新Cookie'}";
            if (hasCF) {
              statusDiv.style.background = "green";
              setTimeout(() => { location.href = '/'; }, 2000);
            }
          }, 1000);
        })();
      </script>`;

      text = text.replace('</body>', `${feedbackScript}</body>`);
      return res.status(response.status).send(text.split(targetHost).join(myHost));
    }

    const buffer = await response.arrayBuffer();
    return res.status(response.status).send(Buffer.from(buffer));

  } catch (err) {
    return res.status(502).send("Error: " + err.message);
  }
}
