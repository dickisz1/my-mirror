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
        /* 1. 基础布局保护：确保漫画图片正常，排版不乱 */
        img { max-width: 100% !important; height: auto !important; }
        .manga-page img { width: 100% !important; }
        .notice-icon, img[src*="notice"] { max-width: 30px !important; }

        /* 2. 广告精准粉碎（基于你提供的 uBlock 规则） */
        
        /* 拦截伪装成 input 的图片链接广告 */
        a[href][target] > input[alt][src][type][style],
        div:nth-of-type(2) > a > input,
        div[data-group][style] > a[href] > input[alt][src][type][style],
        
        /* 拦截指定的广告区域类名 */
        div.ad-area,
        
        /* 移除“回到顶部”或伪装的浮动图标 */
        img.return-top,

        /* 3. 补充封杀：拦截常见的悬浮毒瘤 */
        .fixed-ad, 
        .game-link, 
        .sign-link, 
        a[href*="game"],
        .swiper-slide img[src*="ads"] 
        {
          display: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
          pointer-events: none !important; /* 防止误点 */
          height: 0 !important;
          margin: 0 !important;
        }

        /* 4. 解决碎图占位问题 */
        img[src=""], img:not([src]) { display: none !important; }
      </style>

      <script>
        (function() {
          // 通关通知逻辑
          if (Notification.permission === 'default') Notification.requestPermission();
          let notified = false;
          setInterval(() => {
            if (document.cookie.includes('cf_clearance') && !notified) {
              new Notification("✅ 极净模式（规则已同步）", { body: "已加载最新的 uBlock 精准规则" });
              notified = true;
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
