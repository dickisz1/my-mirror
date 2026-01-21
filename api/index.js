export const config = { runtime: 'edge' };

export default async function handler(req) {
  const targetHost = "manwa.me";
  const url = new URL(req.url);
  const myHost = url.host; // 这里会自动获取你的 dickisz123.dpdns.org

  // --- 1. 深度拦截名单（拦截那些导致卡顿的红色请求） ---
  const blockList = [
    'popunder1000.js', 'venor.php', 'chicken.gif', '/rum', 
    'jserror', 'code.js', 'analytics', 'ads'
  ];
  if (blockList.some(item => url.pathname.includes(item) || url.search.includes(item))) {
    return new Response('', { status: 204 }); // 直接掐断，不给加载机会
  }

  // --- 2. 资源代理中转（穿透墙，加载图片和脚本） ---
  if (url.pathname.startsWith('/_proxy_/')) {
    // 还原真实的远程 URL
    const actualUrl = url.pathname.replace('/_proxy_/', 'https://') + url.search;
    
    try {
      const proxyRes = await fetch(actualUrl, {
        headers: {
          'referer': `https://${targetHost}/`,
          'user-agent': req.headers.get('user-agent')
        }
      });

      const newHeaders = new Headers(proxyRes.headers);
      newHeaders.set('Access-Control-Allow-Origin', '*'); // 允许跨域，防止报错
      newHeaders.delete('content-security-policy');
      newHeaders.set('Cache-Control', 'public, max-age=86400'); // 缓存一天，省流量

      return new Response(proxyRes.body, { status: proxyRes.status, headers: newHeaders });
    } catch (e) {
      return new Response('', { status: 404 });
    }
  }

  // --- 3. HTML 抓取与深度重写 ---
  const targetUrl = `https://${targetHost}${url.pathname}${url.search}`;
  const res = await fetch(targetUrl, {
    headers: { 
      'host': targetHost, 
      'referer': `https://${targetHost}/`,
      'cookie': '', // 匿名访问
      'user-agent': req.headers.get('user-agent')
    }
  });

  if (res.headers.get('content-type')?.includes('text/html')) {
    let text = await res.text();

    // A. 暴力替换：将所有 manwa.me 的资源链接重写为走你的代理
    // 匹配 https://...manwa.me... 并强制加上你的代理前缀
    text = text.replace(/https:\/\/([a-zA-Z0-9][-a-zA-Z0-9]{0,62}(\.[a-zA-Z0-9][-a-zA-Z0-9]{0,62})+)/g, (match, domain) => {
      if (domain.includes(targetHost) || domain.includes('img.manwa')) {
        return `https://${myHost}/_proxy_/${domain}`;
      }
      return match;
    });

    // B. 处理特殊的懒加载属性
    text = text.replace(/data-src="/g, 'src="')
               .replace(/data-original="/g, 'src="');

    // C. 注入 JS 脚本：在浏览器端也强制劫持动态发出的 AJAX 请求
    const injectCode = `
    <script>
      (function() {
        // 1. 劫持 Fetch
        const originalFetch = window.fetch;
        window.fetch = function(url, options) {
          if (typeof url === 'string' && url.includes('${targetHost}')) {
            url = '/_proxy_/' + url.replace('https://', '');
          }
          return originalFetch(url, options);
        };
        // 2. 隐藏可能的广告位
        const style = document.createElement('style');
        style.innerHTML = '.ad-box, #popunder { display:none !important; }';
        document.head.appendChild(style);
      })();
    </script>
    `;
    text = text.replace('</head>', `${injectCode}</head>`);

    // D. 全局替换域名，确保点击链接不跳走
    text = text.split(targetHost).join(myHost);

    const headers = new Headers(res.headers);
    headers.delete('Set-Cookie');
    headers.set('Cache-Control', 'no-cache');

    return new Response(text, { status: 200, headers });
  }

  // 其他静态资源（CSS等）直接返回
  return new Response(res.body, { status: res.status, headers: res.headers });
}
完整修改下
