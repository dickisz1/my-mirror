export const config = {
  runtime: 'edge', 
};

export default async function handler(req) {
  const targetHost = "manwa.me";
  const url = new URL(req.url);
  const myHost = url.host;
  const targetUrl = `https://${targetHost}${url.pathname}${url.search}`;

  const newHeaders = new Headers(req.headers);
  newHeaders.set('host', targetHost);
  newHeaders.set('referer', `https://${targetHost}/`);

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: newHeaders,
      redirect: 'manual' 
    });

    const resHeaders = new Headers(response.headers);
    const contentType = resHeaders.get('content-type') || '';

    // --- 修改依据 1：利用 Vercel 边缘缓存实现秒开 ---
    if (response.status < 400 && contentType.includes('text/html')) {
      resHeaders.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=3600');
    }

    if (contentType.includes('text/html')) {
      let text = await response.text();
      
      const injectCode = `
      <style>
        /* --- 修改依据 2：强力隐藏手机端广告容器 --- */
        [class*="ad-"], [id*="ad-"], .footer-float-icon, .notice-icon, 
        div[style*="fixed"] > a[href*="http"], div[style*="z-index: 999999"], 
        .modal-backdrop, .mask { display: none !important; opacity: 0 !important; }
      </style>
      <script>
        (function() {
          // --- 修改依据 3：新增加载时间提示（会在网页左上角显示） ---
          const startTime = performance.now();
          const timerDiv = document.createElement('div');
          timerDiv.id = 'vercel-timer';
          timerDiv.style = "position:fixed;top:10px;left:10px;background:rgba(0,0,0,0.7);color:#0f0;z-index:9999999;padding:4px 8px;font-family:monospace;font-size:12px;border-radius:4px;pointer-events:none;border:1px solid #0f0;";
          document.body.appendChild(timerDiv);

          const updateTimer = () => {
            const loadTime = ((performance.now() - startTime) / 1000).toFixed(2);
            timerDiv.innerText = "⚡ Vercel加速中: " + loadTime + "s";
            if (document.readyState === 'complete') {
              timerDiv.style.color = "#fff";
              timerDiv.style.background = "#28a745";
              setTimeout(() => timerDiv.remove(), 5000); // 加载完成后5秒消失
            }
          };
          setInterval(updateTimer, 100);

          // 预加载逻辑
          const solveLazy = () => {
            document.querySelectorAll('img[data-src], img[data-original]').forEach((img, index) => {
              const src = img.getAttribute('data-src') || img.getAttribute('data-original');
              if (src && img.src !== src) {
                const rect = img.getBoundingClientRect();
                if (index < 10 || rect.top < window.innerHeight * 2) { 
                  img.src = src;
                  img.removeAttribute('data-src');
                }
              }
            });
          };
          setInterval(solveLazy, 500);
        })();
      </script>`;

      text = text.replace('</head>', `${injectCode}</head>`);
      const body = text.split(targetHost).join(myHost);
      return new Response(body, { status: response.status, headers: resHeaders });
    }
    return new Response(response.body, { status: response.status, headers: resHeaders });
  } catch (err) {
    return new Response("Error", { status: 502 });
  }
}
