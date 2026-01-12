export const config = {
  runtime: 'edge', 
};

export default async function handler(req) {
  const targetHost = "manwa.me";
  const url = new URL(req.url);
  const myHost = url.host;
  const targetUrl = `https://${targetHost}${url.pathname}${url.search}`;

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

    const resHeaders = new Headers(response.headers);
    const setCookies = response.headers.getSetCookie();
    resHeaders.delete('set-cookie');
    setCookies.forEach(cookie => {
      resHeaders.append('Set-Cookie', cookie.replace(/Domain=[^;]+;?/gi, "").replace(new RegExp(targetHost, 'g'), myHost));
    });

    if (resHeaders.get('content-type')?.includes('text/html')) {
      let text = await response.text();
      
      // --- 核心净化逻辑开始 ---
      const cleanScript = `
      <style>
        /* 1. 屏蔽常见的广告位样式名 */
        .ads, .ads-wrap, .adv-container, iframe[src*="ads"], 
        div[id*="pop"], .fixed-ad, .bottom-ad, .floating-ad {
          display: none !important;
          visibility: hidden !important;
          height: 0 !important;
        }

        /* 2. 隐藏强制登录/注册的弹窗或侧边栏 */
        .login-modal, .register-guide, .login-prompt,
        .vip-mask, .mask-login {
          display: none !important;
        }

        /* 3. 强制内容区全屏，移除因广告留下的空白 */
        body { padding-top: 0 !important; padding-bottom: 0 !important; }
      </style>
      <script>
        (function() {
          // 定时检测并移除动态生成的广告节点
          setInterval(() => {
            // 移除所有可能是广告的 iframe
            document.querySelectorAll('iframe').forEach(el => {
              if(!el.src.includes('manwa')) el.remove();
            });
            // 自动关闭干扰阅读的登录引导
            const closeBtn = document.querySelector('.close-login-btn, .btn-close');
            if(closeBtn) closeBtn.click();
          }, 2000);

          // 之前的通关通知逻辑
          if (Notification.permission === 'default') Notification.requestPermission();
          setInterval(() => {
            if (document.cookie.includes('cf_clearance') && !window.notified) {
              new Notification("✅ 漫蛙验证通关", { body: "广告已净化，祝阅读愉快！" });
              window.notified = true;
            }
          }, 1500);
        })();
      </script>`;
      // --- 核心净化逻辑结束 ---

      text = text.replace('</head>', `${cleanScript}</head>`);
      return new Response(text.split(targetHost).join(myHost), {
        status: response.status,
        headers: resHeaders
      });
    }

    return new Response(response.body, { status: response.status, headers: resHeaders });

  } catch (err) {
    return new Response("Edge Proxy Error: " + err.message, { status: 502 });
  }
}
