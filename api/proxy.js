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

      // 1. 源码级封杀：根据你之前提供的链接规律直接剔除
      text = text.replace(/https:\/\/mwappimgs\.cc\/static\/upload\/(ads|book\/banner)\/[^"']+/g, '');
      text = text.replace(/https:\/\/mwappimgs\.cc\/static\/images\/new_logo\.svg[^"']+/g, '');

      // 2. 样式级封杀：集成你提供的 uBlock 精准规则
      const injectStyle = `
      <style>
        /* 响应式尺寸：漫画图片全屏 */
        img, .manga-page, .comic-img {
          max-width: 100% !important;
          height: auto !important;
          width: 100% !important;
          display: block !important;
          margin: 0 auto !important;
        }

        /* --- uBlock 精准规则集成 --- */
        /* 拦截伪装成 input 的图片链接广告 */
        a[href][target] > input[alt][src][type][style],
        /* 移除“回到顶部”图标或伪装图标 */
        img.return-top,
        /* 屏蔽广告占位与常见垃圾元素 */
        [class*="ads"], [id*="ads"], .fixed-ad, .ad-item, .pop-window, 
        .login-guide, .login-mask, .download-app-bar, iframe {
          display: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
          pointer-events: none !important;
        }

        img[src=""], img:not([src]) { display: none !important; }
        html, body { overflow-x: hidden !important; width: 100% !important; padding: 0 !important; margin: 0 !important; }
      </style>`;

      const injectScript = `
      <script>
        (function() {
          // 反调试保护
          const _constructor = window.Function.prototype.constructor;
          window.Function.prototype.constructor = function(str) {
            if (str === 'debugger') return function() {};
            return _constructor.apply(this, arguments);
          };

          // 动态清理元素
          const clean = () => {
            document.querySelectorAll('div, a, span').forEach(el => {
              const txt = el.innerText;
              if (txt.includes('下载APP') || txt.includes('登录观看') || txt.includes('立即充值')) {
                const p = el.closest('div') || el.parentElement;
                if(p) p.style.display = 'none';
              }
            });
          };
          setInterval(clean, 1500);

          // 通关通知
          if ("Notification" in window && Notification.permission === 'default') Notification.requestPermission();
          let notified = false;
          setInterval(() => {
            if (document.cookie.includes('cf_clearance') && !notified) {
              new Notification("✅ 极净通道已就绪", { body: "已同步最新 uBlock 屏蔽规则" });
              notified = true;
            }
          }, 2000);
        })();
      </script>`;

      text = text.replace('</head>', `${injectStyle}${injectScript}</head>`);
      return new Response(text.split(targetHost).join(myHost), {
        status: response.status,
        headers: resHeaders
      });
    }

    return new Response(response.body, { status: response.status, headers: resHeaders });
  } catch (err) {
    return new Response("Error: " + err.message, { status: 502 });
  }
}export const config = {
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
