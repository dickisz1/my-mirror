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
      </style>
      <script>
  (function() {
    const solveLazy = () => {
      const imgs = document.querySelectorAll('img[data-src], img[data-original]');
      imgs.forEach((img, index) => {
        const src = img.getAttribute('data-src') || img.getAttribute('data-original');
        if (src && img.src !== src) {
          // 如果是前 10 张图，或者是距离屏幕较近的图，直接加载
          const rect = img.getBoundingClientRect();
          if (index < 10 || rect.top < window.innerHeight * 2) { 
            img.src = src;
            img.removeAttribute('data-src');
          }
        }
      });
    };
    // 提高扫描频率到 0.5 秒，让图片加载反应更快
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
