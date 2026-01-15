export const config = {
  runtime: 'edge', // 强制边缘运行时
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
      redirect: 'manual' // 手动处理重定向以优化缓存
    });

    const resHeaders = new Headers(response.headers);

    // --- 【关键修改点：智能缓存策略】 ---
    // 1. 如果是图片、字体等静态资源，缓存时间延长到 1 天 (s-maxage=86400)
    // 2. 如果是 HTML，缓存 60 秒，并允许旧页面在后台更新 (stale-while-revalidate)
    const contentType = resHeaders.get('content-type') || '';
    if (response.status < 400) {
      if (contentType.includes('text/html')) {
        resHeaders.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=600');
      } else {
        // 静态资源加速：让 Vercel 节点长期缓存，国内访问直接秒开
        resHeaders.set('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=3600');
      }
      resHeaders.set('X-Proxy-Step', `Success-Status-${response.status}`);
    }

    const setCookies = response.headers.getSetCookie();
    resHeaders.delete('set-cookie');
    setCookies.forEach(c => resHeaders.append('Set-Cookie', c.replace(/Domain=[^;]+;?/gi, "").replace(new RegExp(targetHost, 'g'), myHost)));

    // HTML 内容处理
    if (contentType.includes('text/html')) {
      let text = await response.text();

      const adShield = `
      <style>
        a[href][target][rel][style], div.footer-float-icon, i.fas.fa-times, img.return-top,
        div:has(> a > input), div[data-group] > a > input {
          position: absolute !important;
          top: -9999px !important;
          opacity: 0 !important;
        }
        img[src*="notice"], .notice-icon { width: 32px !important; height: auto !important; }
      </style>
      <script>
        (function() {
          window.alert = function() { return true; };
          const killPopup = () => {
            const elements = document.querySelectorAll('div, button, section');
            elements.forEach(el => {
              if (el.innerText && (el.innerText.includes('关闭阻挡广告插件') || el.innerText.includes('官方推荐浏览器'))) {
                const btn = el.querySelector('button') || el;
                if (btn) btn.click();
                el.remove();
              }
            });
            document.querySelectorAll('.modal-backdrop, [class*="mask"]').forEach(m => m.remove());
          };
          setInterval(killPopup, 500);
        })();
      </script>`;

      text = text.replace('</head>', `${adShield}</head>`);
      resHeaders.set('X-Proxy-Step', 'HTML-Injected-And-Cached');

      return new Response(text.split(targetHost).join(myHost), {
        status: response.status,
        headers: resHeaders
      });
    }

    // 非 HTML 资源处理
    return new Response(response.body, { 
        status: response.status, 
        headers: resHeaders 
    });

  } catch (err) {
    return new Response("Proxy Error: " + err.message, { 
        status: 502,
        headers: { 'X-Proxy-Step': 'Failed-At-Edge' }
    });
  }
}
