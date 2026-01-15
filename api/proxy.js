export const config = {
  runtime: 'edge', // 确保使用 Edge Runtime 提升响应速度
};

export default async function handler(req) {
  const targetHost = "manwa.me";
  const url = new URL(req.url);
  const myHost = url.host;
  const targetUrl = `https://${targetHost}${url.pathname}${url.search}`;

  // --- 步骤标记：开始解析 ---
  const stepHeader = { 'X-Proxy-Step': '1-Initialized' };

  const newHeaders = new Headers();
  req.headers.forEach((v, k) => {
    if (k.toLowerCase() !== 'host') {
      newHeaders.set(k, v.replace(new RegExp(myHost, 'g'), targetHost));
    }
  });

  try {
    // --- 步骤标记：准备请求源站 ---
    console.log(`Fetching: ${targetUrl}`);
    
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: newHeaders,
      redirect: 'manual'
    });

    const resHeaders = new Headers(response.headers);

    // --- 流畅度优化：添加边缘缓存策略 ---
    // s-maxage: 允许 Vercel 节点缓存内容（静态资源建议设长，HTML 设短一点）
    // stale-while-revalidate: 过期时先给旧页面，后台静默更新，极速响应
    if (response.ok) {
        resHeaders.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
        resHeaders.set('X-Proxy-Step', '2-Fetch-Success');
    }

    const setCookies = response.headers.getSetCookie();
    resHeaders.delete('set-cookie');
    setCookies.forEach(c => resHeaders.append('Set-Cookie', c.replace(/Domain=[^;]+;?/gi, "").replace(new RegExp(targetHost, 'g'), myHost)));

    // 如果是 HTML，注入去广告代码
    if (resHeaders.get('content-type')?.includes('text/html')) {
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
      
      // --- 步骤标记：完成 HTML 处理 ---
      resHeaders.set('X-Proxy-Step', '3-HTML-Processed');

      return new Response(text.split(targetHost).join(myHost), {
        status: response.status,
        headers: resHeaders
      });
    }

    // 非 HTML 资源直接返回
    return new Response(response.body, { 
        status: response.status, 
        headers: resHeaders 
    });

  } catch (err) {
    // --- 错误标记：记录到哪一步出错了 ---
    return new Response("Error: " + err.message, { 
        status: 502,
        headers: { 'X-Proxy-Step': 'Error-At-Fetch' }
    });
  }
}
