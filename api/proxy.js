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
   const baseInject = 
`
      <style>
        /* 1. 强制清场：删掉所有漫蛙原有的视觉元素 */
        header, footer, .footer, .nav, .fixed-ad, .game-link, .sign-link, .notice-wrap, 
        .ad-area, .bottom-ad, .fixed-widgets, #ad_root, .swiper-pagination {
          display: none !important;
        }

        /* 2. 重塑背景：使用 QQ 动漫常用的沉浸暗色或极简灰白 */
        body {
          background-color: #1a1a1a !important; /* 深色阅读模式 */
          margin: 0 !important;
          padding-top: 50px !important; /* 给新标题栏留位置 */
          display: flex !important;
          flex-direction: column !important;
          align-items: center !important;
        }

        /* 3. 新建 QQ 动漫风格标题栏 (伪元素模拟) */
        body::before {
          content: "漫蛙·极净阅读";
          position: fixed;
          top: 0; left: 0; right: 0;
          height: 45px;
          background: rgba(30, 30, 30, 0.95);
          color: #fff;
          text-align: center;
          line-height: 45px;
          font-size: 16px;
          font-weight: bold;
          z-index: 99999;
          border-bottom: 1px solid #333;
          backdrop-filter: blur(10px);
        }

        /* 4. 漫画内容核心重组 */
        .manga-page, .comic-img-container, .content-box {
          width: 100% !important;
          max-width: 800px !important; /* 限制大屏幕下的最大宽度，模拟手机观感 */
          margin: 0 auto !important;
          background: #000 !important;
        }

        /* 5. 图片自适应：每一张图都要整齐排列，无缝对接 */
        img {
          width: 100% !important;
          display: block !important;
          margin-bottom: 2px !important; /* 漫画页之间的微小间隙 */
          border: none !important;
        }

        /* 6. 解决你提供的所有精准 uBlock 规则 */
        a[href][target] > input, div[data-group] > a > input, img.return-top {
          display: none !important;
        }
      </style>

      <script>
        (function() {
          // 移除所有可能存在的 iframe 劫持
          setInterval(() => {
            document.querySelectorAll('iframe').forEach(f => f.remove());
            // 自动移除页面上任何包含“下载”或“广告”字样的浮动层
            document.querySelectorAll('div').forEach(div => {
              if (window.getComputedStyle(div).position === 'fixed' && 
                 (div.innerText.includes('APP') || div.innerText.includes('广告'))) {
                div.remove();
              }
            });
          }, 2000);
        })();
      </script>`
;

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
