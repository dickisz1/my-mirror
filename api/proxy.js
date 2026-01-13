export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  const targetHost = "manwa.me";
  const url = new URL(req.url);
  const myHost = url.host;
  const targetUrl = `https://${targetHost}${url.pathname}${url.search}`;

  // 1. 转发请求头，并屏蔽 Host 防止循环
  const newHeaders = new Headers();
  req.headers.forEach((v, k) => {
    if (k.toLowerCase() !== 'host') {
      newHeaders.set(k, v.replace(new RegExp(myHost, 'g'), targetHost));
    }
  });

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: newHeaders,
      redirect: 'manual'
    });

    const resHeaders = new Headers(response.headers);
    
    // 2. 关键：同步 Cookie 并处理域名作用域，保证“打勾”验证有效
    const setCookies = response.headers.getSetCookie();
    resHeaders.delete('set-cookie');
    setCookies.forEach(c => {
      resHeaders.append('Set-Cookie', c.replace(/Domain=[^;]+;?/gi, "").replace(new RegExp(targetHost, 'g'), myHost));
    });

    // 3. 处理 HTML 页面
    if (resHeaders.get('content-type')?.includes('text/html')) {
      let text = await response.text();

      // 仅注入最安全的样式和验证逻辑
      const safeInject = `
      <style>
        /* 仅保证图片填满宽度，不改动其他任何图标尺寸 */
        .manga-page img, .comic-img {
          width: 100% !important;
          max-width: 100% !important;
          height: auto !important;
          display: block !important;
        }
        /* 确保 Cloudflare 验证框始终可见 */
        #cf-bubbles, .cf-turnstile { display: block !important; visibility: visible !important; }
      </style>
      <script>
        (function() {
          // 仅用于提示验证状态
          setInterval(() => {
            if (document.cookie.includes('cf_clearance') && !window.notified) {
              console.log("✅ 验证已通过");
              window.notified = true;
            }
          }, 2000);
        })();
      </script>`;

      text = text.replace('</head>', `${safeInject}</head>`);
      
      // 保持域名替换，确保链接能点击
      return new Response(text.split(targetHost).join(myHost), {
        status: response.status,
        headers: resHeaders
      });
    }

    // 非 HTML 内容（图片等）直接返回
    return new Response(response.body, { status: response.status, headers: resHeaders });

  } catch (err) {
    return new Response("Proxy Error: " + err.message, { status: 502 });
  }
}
