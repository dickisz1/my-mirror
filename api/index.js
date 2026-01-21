export const config = { runtime: 'edge' };

export default async function handler(req) {
  const targetHost = "manwa.me";
  const url = new URL(req.url);
  // 关键：自动识别当前访问域名（无论是 vercel.app 还是你的 dpdns 域名）
  const myHost = url.host; 

  // --- 1. 深度拦截名单（防止流氓脚本干扰） ---
  const blockList = [
    'popunder', 'venor.php', 'chicken.gif', '/rum', 
    'jserror', 'code.js', 'analytics', 'ads', 'click'
  ];
  if (blockList.some(item => url.pathname.includes(item))) {
    return new Response('', { status: 204 });
  }

  // --- 2. 资源代理中转（解决图片加载 403 问题的核心） ---
  if (url.pathname.startsWith('/_proxy_/')) {
    const actualUrl = url.pathname.replace('/_proxy_/', 'https://') + url.search;
    
    try {
      const proxyRes = await fetch(actualUrl, {
        headers: {
          'referer': `https://${targetHost}/`,
          'user-agent': req.headers.get('user-agent') || 'Mozilla/5.0 (Linux; Android 10)'
        }
      });

      const newHeaders = new Headers(proxyRes.headers);
      newHeaders.set('Access-Control-Allow-Origin', '*'); 
      newHeaders.delete('content-security-policy');
      newHeaders.set('Cache-Control', 'public, max-age=86400'); // 缓存图片，加速显示

      return new Response(proxyRes.body, { status: proxyRes.status, headers: newHeaders });
    } catch (e) {
      return new Response('', { status: 404 });
    }
  }

  // --- 3. 核心抓取逻辑 ---
  // 构造发往主站的真实地址
  const targetUrl = `https://${targetHost}${url.pathname}${url.search}`;
  
  try {
    const res = await fetch(targetUrl, {
      headers: { 
        'host': targetHost, 
        'referer': `https://${targetHost}/`,
        'user-agent': req.headers.get('user-agent') || 'Mozilla/5.0 (Linux; Android 10)'
      }
    });

    // 如果是 HTML 页面，进行“换脸”处理
    if (res.headers.get('content-type')?.includes('text/html')) {
      let text = await res.text();

      // A. 域名全局替换：把网页里所有的 manwa.me 换成你的域名，防止点击后跳回原站
      text = text.split(targetHost).join(myHost);

      // B. 资源路径劫持：把所有图片/脚本路径重定向到我们的代理接口
      // 匹配 https://...img.manwa... 等资源
      text = text.replace(/https:\/\/([a-zA-Z0-9][-a-zA-Z0-9]{0,62}(\.[a-zA-Z0-9][-a-zA-Z0-9]{0,62})+)/g, (match, domain) => {
        if (domain.includes('manwa') || domain.includes('img')) {
          return `https://${myHost}/_proxy_/${domain}`;
        }
        return match;
      });

      // C. 强力修复懒加载：把 data-src 直接换成 src，确保漫画能直接显示
      text = text.replace(/data-src=/g, 'src=')
                 .replace(/data-original=/g, 'src=');

      // D. 注入客户端脚本：防止浏览器端的 JS 自动跳转
      const injectCode = `
      <script>
        (function() {
          // 劫持所有的动态跳转
          window.onbeforeunload = function() { return null; };
          // 劫持 Fetch 请求
          const oldFetch = window.fetch;
          window.fetch = function(u, o) {
            if (typeof u === 'string' && u.includes('manwa')) {
              u = '/_proxy_/' + u.replace('https://', '');
            }
            return oldFetch(u, o);
          };
        })();
      </script>
      `;
      text = text.replace('</head>', `${injectCode}</head>`);

      const headers = new Headers(res.headers);
      headers.delete('Set-Cookie'); // 保持匿名
      headers.set('Content-Type', 'text/html; charset=utf-8');

      return new Response(text, { status: 200, headers });
    }

    // 非 HTML 资源（CSS/JS）直接返回
    return new Response(res.body, { status: res.status, headers: res.headers });

  } catch (error) {
    // 如果抓取主站失败，返回错误而非跳转 Google
    return new Response("代理中转失败，请检查主站是否在线: " + error.message, { status: 500 });
  }
}
