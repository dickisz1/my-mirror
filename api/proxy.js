// 必须安装流处理工具，Vercel 环境自带 buffer 处理
export const config = {
  api: { bodyParser: false }, // 关键：禁用 Vercel 默认解析，保留原始数据包
};

export default async function handler(req, res) {
  const targetHost = "manwa.me";
  const myHost = req.headers.host;
  const url = `https://${targetHost}${req.url}`;

  // 1. 获取原始 Body (解决 415 错误的关键)
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const rawBody = Buffer.concat(chunks);

  // 2. 构造头信息
  const requestHeaders = {};
  const headersToCopy = ['user-agent', 'accept', 'accept-language', 'cookie', 'referer', 'content-type', 'origin'];
  headersToCopy.forEach(h => {
    if (req.headers[h]) requestHeaders[h] = req.headers[h].split(myHost).join(targetHost);
  });

  try {
    const response = await fetch(url, {
      method: req.method,
      headers: requestHeaders,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? rawBody : undefined,
      redirect: 'manual'
    });

    // 3. 强力捕获并修正 Cookie
    const setCookies = response.headers.getSetCookie();
    let debugMark = "WAITING";
    
    if (setCookies.length > 0) {
      setCookies.forEach(cookie => {
        if (cookie.includes("cf_clearance")) debugMark = "GOT_CF_TOKEN";
        const cleanCookie = cookie
          .replace(/Domain=[^;]+;?/gi, "") 
          .replace(/Path=[^;]+;?/gi, "Path=/;")
          .replace(/Secure|SameSite=None/gi, "")
          .split(targetHost).join(myHost);
        res.appendHeader('Set-Cookie', cleanCookie);
      });
    }

    // 4. 处理内容
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      let text = await response.text();
      
      // 注入【不触发反调试】的监控层
      const monitor = `
      <div id="p-status" style="position:fixed;top:10px;right:10px;background:rgba(0,0,0,0.8);color:#0f0;padding:10px;z-index:999999;font-size:12px;border:1px solid #0f0;">
        状态: <span id="s-val">检测中...</span><br>
        后端: ${debugMark}
      </div>
      <script>
        setInterval(() => {
          const hasCF = document.cookie.includes("cf_clearance");
          document.getElementById('s-val').innerText = hasCF ? "✅ 秘钥已就绪" : "❌ 未拿到";
          if(hasCF) {
            document.getElementById('p-status').style.background = "green";
            document.getElementById('p-status').style.color = "white";
            setTimeout(() => { location.href = '/'; }, 2000);
          }
        }, 1000);
      </script>`;
      
      return res.send(text.replace('</body>', monitor + '</body>').split(targetHost).join(myHost));
    }

    const buffer = await response.arrayBuffer();
    return res.status(response.status).send(Buffer.from(buffer));

  } catch (err) {
    return res.status(502).send("Forward Error: " + err.message);
  }
}
