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

      // --- 核心样式增强：响应式尺寸 + 广告粉碎 ---
      const injectCode = `
      <style>
        /* 1. 漫画图片尺寸自适应：无论浏览器多大，图片始终填满宽度且不失真 */
        img, .manga-page, .comic-img {
          max-width: 100% !important;
          height: auto !important;
          width: 100% !important;
          display: block !important;
          margin: 0 auto !important;
        }

        /* 2. 强制隐藏广告与登录提示：
           这里涵盖了漫蛙常见的：顶部banner、悬浮窗、弹窗、APP下载提示、登录遮罩 */
        [class*="ads"], [id*="ads"], 
        .fixed-ad, .ad-item, .pop-window, 
        .login-guide, .login-mask, .vip-pay-guide,
        .download-app-bar, .footer-ad, .header-ad,
        iframe, #ad_root {
          display: none !important;
          opacity: 0 !important;
          pointer-events: none !important;
        }

        /* 3. 移除多余的间距，让阅读更沉浸 */
        html, body { overflow-x: hidden !important; width: 100% !important; padding: 0 !important; margin: 0 !important; }
        .container, .content-box { width: 100% !important; padding: 0 !important; }
      </style>
      
      <script>
        (function() {
          // 自动化处理：移除动态加载的广告
          const clean = () => {
            // 查找所有包含“登录”、“下载”、“广告”等字眼的按钮并移除
            document.querySelectorAll('div, a, span').forEach(el => {
              const txt = el.innerText;
              if (txt.includes('下载APP') || txt.includes('登录观看') || txt.includes('立即充值')) {
                el.parentElement.style.display = 'none';
              }
            });
          };
          
          setInterval(clean, 1000);
          
          // 之前的通关同步逻辑
          if (Notification.permission === 'default') Notification.requestPermission();
          setInterval(() => {
            if (document.cookie.includes('cf_clearance') && !window.notified) {
              new Notification("✅ 漫蛙极净模式已启动", { body: "尺寸自适应已就绪" });
              window.notified = true;
            }
          }, 2000);
        })();
      </script>`;

      text = text.replace('</head>', `${injectCode}</head>`);
      return new Response(text.split(targetHost).join(myHost), { status: response.status, headers: resHeaders });
    }

    return new Response(response.body, { status: response.status, headers: resHeaders });
  } catch (err) {
    return new Response("Error: " + err.message, { status: 502 });
  }
}
