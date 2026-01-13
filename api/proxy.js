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

      // 1. 规律封杀：源码级剔除广告链接（针对 mwappimgs.cc）
      text = text.replace(/https:\/\/mwappimgs\.cc\/static\/upload\/ads\/[^"']+/g, '');
      text = text.replace(/https:\/\/mwappimgs\.cc\/static\/upload\/book\/banner\/[^"']+/g, '');
      text = text.replace(/https:\/\/mwappimgs\.cc\/static\/images\/new_logo\.svg[^"']+/g, '');

      // 2. 注入 CSS (净化样式 + 自适应)
      const injectStyle = `
      <style>
        /* 响应式尺寸：图片填满屏幕 */
        img, .manga-page, .comic-img {
          max-width: 100% !important;
          height: auto !important;
          width: 100% !important;
          display: block !important;
          margin: 0 auto !important;
        }
        /* 隐藏广告占位及特定关键词 */
        img[src=""], img:not([src]), a[href*="俱乐部"], a[href*="club"], .fixed-banner, 
        [class*="ads"], [id*="ads"], .fixed-ad, .ad-item, .pop-window, 
        .login-guide, .login-mask, .download-app-bar, iframe {
          display: none !important;
          opacity: 0 !important;
        }
        html, body { overflow-x: hidden !important; width: 100% !important; padding: 0 !important; margin: 0 !important; }
      </style>`;

      // 3. 注入 JS (反调试保护 + 自动清理 + 通关通知)
      const injectScript = `
      <script>
        (function() {
          // --- 反调试保护 ---
          const _constructor = window.Function.prototype.constructor;
          window.Function.prototype.constructor = function(str) {
            if (str === 'debugger') return function() {};
            return _constructor.apply(this, arguments);
          };

          // --- 自动清理动态元素 ---
          const clean = () => {
            document.querySelectorAll('div, a, span').forEach(el => {
              const txt = el.innerText;
              if (txt.includes('下载APP') || txt.includes('登录观看') || txt.includes('立即充值')) {
                el.parentElement.style.display = 'none';
              }
            });
          };
          setInterval(clean, 1500);

          // --- 通关通知 ---
          if ("Notification" in window && Notification.permission === 'default') Notification.requestPermission();
          setInterval(() => {
            if (document.cookie.includes('cf_clearance') && !window.notified) {
              new Notification("✅ 极净模式已启动", { body: "已为您自动优化排版并拦截广告" });
              window.notified = true;
            }
          }, 2000);
        })();
      </script>`;

      text = text.replace('</head>', `${injectStyle}${injectScript}</head>`);
      
      // 执行最终域名替换并返回
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
