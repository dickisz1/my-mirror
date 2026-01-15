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
      if (contentType.includes('text/html')) {
        // 网页缓存 1 分钟，后台异步更新
        resHeaders.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=600');
      } else {
        // 图片等静态资源缓存 1 天
        resHeaders.set('Cache-Control', 'public, s-maxage=86400');
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
          // 破解懒加载：每秒扫描一次并将 data-src 转换为真实的 src
          const solveLazy = () => {
            document.querySelectorAll('img[data-src], img[data-original]').forEach(img => {
              const src = img.getAttribute('data-src') || img.getAttribute('data-original');
              if (src && img.src !== src) {
                img.src = src;
                img.removeAttribute('data-src');
              }
            });
          };
          setInterval(solveLazy, 1000);
          window.alert = () => true; // 屏蔽烦人的弹窗
        })();
      </script>`;

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
