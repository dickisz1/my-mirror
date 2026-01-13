export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  const targetHost = "manwa.me";
  const url = new URL(req.url);
  const myHost = url.host;
  const targetUrl = `https://${targetHost}${url.pathname}${url.search}`;

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
    const setCookies = response.headers.getSetCookie();
    resHeaders.delete('set-cookie');
    setCookies.forEach(c => resHeaders.append('Set-Cookie', c.replace(/Domain=[^;]+;?/gi, "").replace(new RegExp(targetHost, 'g'), myHost)));

    if (resHeaders.get('content-type')?.includes('text/html')) {
      let text = await response.text();

      // 只注入最基础的逻辑，不改动原始 HTML 内容
      const baseInject = `
      <style>
        /* 仅保证图片自适应，不破坏页面结构 */
        img { max-width: 100% !important; height: auto !important; }
        .manga-page img { width: 100% !important; }
      </style>
      <script>
        (function() {
          // 仅保留通关通知，方便我们观察秘钥状态
          if (Notification.permission === 'default') Notification.requestPermission();
          setInterval(() => {
            if (document.cookie.includes('cf_clearance') && !window.notified) {
              new Notification("✅ 基础通道已建立", { body: "请观察页面广告情况" });
              window.notified = true;
            }
          }, 2000);
        })();
      </script>`;

      text = text.replace('</head>', `${baseInject}</head>`);
      return new Response(text.split(targetHost).join(myHost), {
        status: response.status,
        headers: resHeaders
      });
    }
    return new Response(response.body, { status: response.status, headers: resHeaders });
  } catch (err) {
    return new Response("Error: " + err.message, { status: 502 });
  }
}
