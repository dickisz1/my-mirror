export const config = { runtime: 'edge' };

export const handler = async (req) => {
  const targetHost = "manwa.me";
  const url = new URL(req.url);
  const myHost = url.host;

  // --- 1. 全能代理转发 (让“红色”请求穿透 GFW) ---
  // 匹配所有以 /_proxy_/ 开头的请求
  if (url.pathname.startsWith('/_proxy_/')) {
    const actualUrl = url.pathname.replace('/_proxy_/', 'https://') + url.search;
    
    // 这里就是“拦截”发生的地方：如果是已知的垃圾脚本，直接掐断
    const blackList = ['popunder', 'chicken.gif', 'rum', 'jserror'];
    if (blackList.some(item => actualUrl.includes(item))) {
      return new Response('', { status: 204 }); // 拦截：直接返回“无内容”
    }

    try {
      const proxyRes = await fetch(actualUrl, {
        headers: {
          'referer': `https://${targetHost}/`,
          'user-agent': req.headers.get('user-agent'),
        }
      });

      const newHeaders = new Headers(proxyRes.headers);
      newHeaders.set('Access-Control-Allow-Origin', '*'); // 解决跨域报错
      newHeaders.delete('content-security-policy'); // 移除源站安全限制
      
      return new Response(proxyRes.body, { 
        status: proxyRes.status, 
        headers: newHeaders 
      });
    } catch (e) {
      return new Response('Proxy Error', { status: 502 });
    }
  }

  // --- 2. 抓取 HTML 主体 ---
  const targetUrl = `https://${targetHost}${url.pathname}${url.search}`;
  const res = await fetch(targetUrl, {
    headers: { 
      'host': targetHost, 
      'referer': `https://${targetHost}/`,
      'cookie': '' 
    }
  });

  if (res.headers.get('content-type')?.includes('text/html')) {
    let text = await res.text();

    // --- 3. 核心逻辑：重写 HTML 中的资源路径 ---
    
    // A. 解决图片加载
    text = text.replace(/data-src="https:\/\//g, `src="https://${myHost}/_proxy_/`)
               .replace(/data-original="https:\/\//g, `src="https://${myHost}/_proxy_/`)
               .replace(/src="https:\/\/img\.manwa\.me/g, `src="https://${myHost}/_proxy_/img.manwa.me`);

    // B. 让 JS 脚本“穿透”：将所有的 <script src="https://..."> 替换为代理路径
    // 这样浏览器就会去请求你的 Edge 节点，而不是直连被屏蔽的域名
    text = text.replace(/<script[^>]*src="https:\/\/([^"]+)"/gi, (match, p1) => {
      // 如果已经是你自己的域名则不换，否则全部走代理
      if (p1.includes(myHost)) return match;
      return match.replace(`https://${p1}`, `https://${myHost}/_proxy_/${p1}`);
    });

    // C. 针对你截图中红色的特定 XHR/API 请求进行劫持（如 venor.php）
    // 通过在 HTML 末尾注入一小段 JS，拦截浏览器的 fetch/XMLHttpRequest 请求
    const injectScript = `
    <script>
      (function() {
        const originFetch = window.fetch;
        window.fetch = function(url, options) {
          if (typeof url === 'string' && url.includes('venor.php')) {
            url = '/_proxy_/' + url.replace('https://', '');
          }
          return originFetch(url, options);
        };
      })();
    </script>`;
    text = text.replace('</body>', `${injectScript}</body>`);

    // D. 全局域名替换
    text = text.split(targetHost).join(myHost);

    const headers = new Headers(res.headers);
    headers.delete('Set-Cookie');
    headers.set('Cache-Control', 'public, s-maxage=3600');
    
    return new Response(text, { status: 200, headers });
  }

  // 其他静态资源（CSS/直接访问的图片等）
  return new Response(res.body, { status: res.status, headers: res.headers });
};

export default handler;
