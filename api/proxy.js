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

    // --- 【强力修复：覆盖源站禁止缓存的指令】 ---
    const contentType = resHeaders.get('content-type') || '';
    if (response.status < 400) {
      if (contentType.includes('text/html')) {
        // 网页缓存：s-maxage=60 (节点缓存一分钟), stale-while-revalidate (后台静默更新)
        resHeaders.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=600');
        resHeaders.set('X-Proxy-Step', 'HTML-Cache-Active');
      } else {
        // 静态资源加速：图片/JS/CSS 缓存一天，国内访问直接秒开
        resHeaders.set('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=3600');
        resHeaders.set('X-Proxy-Step', 'Static-Cache-Active');
      }
    }

    // 修复 Cookie
    const setCookies = response.headers.getSetCookie();
    resHeaders.delete('set-cookie');
    setCookies.forEach(c => resHeaders.append('Set-Cookie', c.replace(/Domain=[^;]+;?/gi, "").replace(new RegExp(targetHost, 'g'), myHost)));

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
      return new Response(text.split(targetHost).join(myHost), {
        status: response.status,
        headers: resHeaders
      });
    }

    return new Response(response.body, { status: response.status, headers: resHeaders });

  } catch (err) {
    return new Response("Proxy Error: " + err.message, { 
        status: 502,
        headers: { 'X-Proxy-Step': 'Failed-At-Edge' }
    });
  }
}
