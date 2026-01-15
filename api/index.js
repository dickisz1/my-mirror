export const config = {
  runtime: 'edge', // 确保运行在离你最近的边缘节点
};

export default async function handler(req) {
  const targetHost = "manwa.me";
  const url = new URL(req.url);
  const myHost = url.host;
  const targetUrl = `https://${targetHost}${url.pathname}${url.search}`;

  // 1. 构造请求头，伪装身份
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

    // 2. 【核心功能】智能缓存策略：覆盖源站的 max-age=0
    if (response.status < 400) {
     // 在你的 index.js 中修改 Cache-Control
if (contentType.includes('text/html')) {
  // s-maxage=60: 节点缓存一分钟
  // stale-while-revalidate=3600: 缓存过期后的一个小时内，先给用户看旧的（瞬间打开），后台异步更新
  resHeaders.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=3600');
}
    }

    // 3. 处理 HTML 内容（注入去广告和破解懒加载脚本）
    if (contentType.includes('text/html')) {
      let text = await response.text();
      
      const injectCode = `
      <style>
        /* 这里的代码对应你发出来的去广告规则 */
        a[href][target][rel][style], .footer-float-icon, i.fas.fa-times, 
        img.return-top, div:has(> a > input) { display: none !important; opacity: 0 !important; }
        /* 强制隐藏所有带 ad 字样的容器和悬浮层 */
[class*="ad-"], [id*="ad-"], .footer-float-icon, .notice-icon, 
div[style*="fixed"] > a[href*="http"], 
div[style*="z-index: 999999"], 
.modal-backdrop, .mask { 
    display: none !important; 
    width: 0 !important; 
    height: 0 !important; 
    overflow: hidden !important; 
}
      </style>
    <script>
(function() {
    // 增加耗时显示
    const startTime = performance.now();
    const timerDiv = document.createElement('div');
    timerDiv.style = "position:fixed;top:5px;left:5px;background:rgba(0,0,0,0.5);color:#fff;z-index:999999;padding:2px 5px;font-size:10px;border-radius:3px;pointer-events:none;";
    document.body.appendChild(timerDiv);

    const updateTimer = () => {
        const loadTime = ((performance.now() - startTime) / 1000).toFixed(2);
        timerDiv.innerText = "🚀 加速中: " + loadTime + "s";
        if (document.readyState === 'complete') {
            timerDiv.style.background = "#28a745"; // 加载完变绿
            setTimeout(() => timerDiv.remove(), 3000); // 3秒后消失
        }
    };
    setInterval(updateTimer, 100);

    // 之前的智能预加载逻辑 ...
    const solveLazy = () => {
        const imgs = document.querySelectorAll('img[data-src], img[data-original]');
        imgs.forEach((img, index) => {
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
</script>
      text = text.replace('</head>', `${injectCode}</head>`);
      // 全文替换域名
      const body = text.split(targetHost).join(myHost);

      return new Response(body, { status: response.status, headers: resHeaders });
    }

    // 4. 非 HTML 资源直接返回
    return new Response(response.body, { status: response.status, headers: resHeaders });

  } catch (err) {
    return new Response("Service Unavailable", { status: 503 });
  }
}
