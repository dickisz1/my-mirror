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
        /* 1. 基础布局保护 */
        img { max-width: 100% !important; height: auto !important; }
        .manga-page img { width: 100% !important; }

        /* 2. 广告精准爆破（只隐藏，不删源码，保护排版） */
        /* 顶部大横幅 */
        .swiper-container a[target="_blank"], 
        .swiper-slide img[src*="ads"],
        /* 底部浮动广告 */
        .fixed-ad, div[style*="position: fixed"] > a,
        /* 右侧悬浮球 */
        .game-link, .sign-link, a[href*="game"], .fixed-widgets,
        /* 你的 uBlock 精准规则 */
        a[href][target] > input[alt][src][type][style] 
        {
          display: none !important;
          visibility: hidden !important;
          pointer-events: none !important;
        }

        /* 3. 修正喇叭图标（双重保险） */
        .notice-icon, img[src*="notice"] {
          max-width: 30px !important;
        }
      </style>
      <script>
        (function() {
          if (Notification.permission === 'default') Notification.requestPermission();
          setInterval(() => {
            if (document.cookie.includes('cf_clearance') && !window.notified) {
              new Notification("✅ 极净模式（温和版）已启动", { body: "排版已修复，广告已遮蔽" });
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
