export const config = {
  runtime: 'edge', // 切换到边缘运行环境，穿透力更强
};

export default async function handler(req) {
  const targetHost = "manwa.me";
  const url = new URL(req.url);
  const myHost = url.host;
  const targetUrl = `https://${targetHost}${url.pathname}${url.search}`;

  // 1. 全量克隆 Header，确保浏览器指纹一致
  const newHeaders = new Headers();
  req.headers.forEach((value, key) => {
    if (key.toLowerCase() !== 'host') {
      newHeaders.set(key, value.replace(new RegExp(myHost, 'g'), targetHost));
    }
  });

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: newHeaders,
      redirect: 'manual'
    });

    // 2. 构造响应头
    const resHeaders = new Headers(response.headers);
    const setCookies = response.headers.getSetCookie();
    
    // 清理 Set-Cookie 的 Domain 限制
    resHeaders.delete('set-cookie');
    setCookies.forEach(cookie => {
      const cleanCookie = cookie
        .replace(/Domain=[^;]+;?/gi, "")
        .replace(/Path=[^;]+;?/gi, "Path=/;")
        .replace(new RegExp(targetHost, 'g'), myHost);
      resHeaders.append('Set-Cookie', cleanCookie);
    });

    // 3. 处理 HTML 注入通知
    if (resHeaders.get('content-type')?.includes('text/html')) {
      let text = await response.text();
      
      const notifyScript = `
      <script>
        (function() {
          if (Notification.permission === 'default') Notification.requestPermission();
          setInterval(() => {
            if (document.cookie.includes('cf_clearance') && !window.notified) {
              new Notification("✅ 漫蛙验证通关", { body: "秘钥已同步，正在为您跳转..." });
              window.notified = true;
              setTimeout(() => { location.href = '/'; }, 1000);
            }
          }, 1500);
        })();
      </script>`;

      text = text.replace('</head>', `${notifyScript}</head>`);
      return new Response(text.split(targetHost).join(myHost), {
        status: response.status,
        headers: resHeaders
      });
    }

    // 4. 非 HTML 资源直接返回
    return new Response(response.body, {
      status: response.status,
      headers: resHeaders
    });

  } catch (err) {
    return new Response("Edge Proxy Error: " + err.message, { status: 502 });
  }
}
