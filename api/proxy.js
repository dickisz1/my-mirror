// 核心：禁用 Vercel 对 Body 的干扰
export const config = {
  api: { bodyParser: false, responseLimit: false },
};

export default async function handler(req, res) {
  const targetHost = "manwa.me";
  const myHost = req.headers.host;
  const url = `https://${targetHost}${req.url}`;

  // 1. 强制镜像 Header (解决打勾无效的核心)
  const requestHeaders = {};
  const headersToKeep = [
    'user-agent', 'accept', 'accept-language', 'cookie', 
    'referer', 'content-type', 'x-requested-with', 'sec-ch-ua', 'sec-ch-ua-platform'
  ];
  
  headersToKeep.forEach(h => {
    if (req.headers[h]) {
      // 这里的替换非常关键：要把你的域名换回漫蛙的域名
      requestHeaders[h] = req.headers[h].split(myHost).join(targetHost);
    }
  });

  // 强制补全关键安全头，防止 403/415
  if (!requestHeaders['content-type'] && req.method === 'POST') {
    requestHeaders['content-type'] = 'application/x-www-form-urlencoded';
  }

  try {
    // 2. 使用 Buffer 流式读取并转发
    const chunks = [];
    for await (const chunk of req) { chunks.push(chunk); }
    const rawBody = Buffer.concat(chunks);

    const response = await fetch(url, {
      method: req.method,
      headers: requestHeaders,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? rawBody : undefined,
      redirect: 'manual'
    });

    // 3. 秘钥捕获状态监控
    let debugMark = "WAITING";
    const setCookies = response.headers.getSetCookie();
    
    if (setCookies.length > 0) {
      setCookies.forEach(cookie => {
        if (cookie.includes("cf_clearance")) debugMark = "!!! SUCCESS_GOT_TOKEN !!!";
        const cleanCookie = cookie
          .replace(/Domain=[^;]+;?/gi, "") 
          .replace(/Path=[^;]+;?/gi, "Path=/;")
          .replace(/Secure/gi, "") // 允许在非 HTTPS 调试
          .split(targetHost).join(myHost);
        res.appendHeader('Set-Cookie', cleanCookie);
      });
    }

    // 4. 内容处理与自愈脚本注入
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      let text = await response.text();
      
      const healingScript = `
      <div id="proxy-diag" style="position:fixed;top:10px;right:10px;background:rgba(0,0,0,0.9);color:#0f0;padding:12px;z-index:999999;font-family:monospace;border:1px solid #0f0;box-shadow:0 0 10px #0f0;">
        <b>检测报告</b><br>
        状态: <span id="s-val">待确认</span><br>
        后端: <span style="color:yellow">${debugMark}</span><br>
        <button onclick="clearAll()" style="margin-top:5px;background:#f00;color:#fff;border:none;cursor:pointer;">点此强制重置环境</button>
      </div>
      <script>
        function clearAll() {
          document.cookie.split(";").forEach(function(c) { 
            document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/"); 
          });
          location.reload();
        }
        setInterval(() => {
          const hasCF = document.cookie.includes("cf_clearance");
          document.getElementById('s-val').innerText = hasCF ? "✅ 拿到秘钥" : "❌ 暂无秘钥";
          if(hasCF) {
            document.getElementById('proxy-diag').style.background = "#004400";
            setTimeout(() => { location.href = '/'; }, 1000);
          }
        }, 1000);
      </script>`;

      text = text.replace('</body>', `${healingScript}</body>`);
      return res.send(text.split(targetHost).join(myHost));
    }

    const buffer = await response.arrayBuffer();
    return res.status(response.status).send(Buffer.from(buffer));

  } catch (err) {
    return res.status(502).send("Proxy Error: " + err.message);
  }
}
