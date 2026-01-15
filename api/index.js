export const config = { runtime: 'edge' };

export default async function handler(req) {
  const targetHost = "manwa.me";
  const url = new URL(req.url);
  const myHost = url.host;

  // 1. 处理图片代理逻辑：如果请求路径包含 _img_proxy_，则中转图片
  if (url.pathname.startsWith('/_img_proxy_/')) {
    const actualImageUrl = url.pathname.replace('/_img_proxy_/', 'https://');
    const imgRes = await fetch(actualImageUrl, {
      headers: { 'referer': `https://${targetHost}/` }
    });
    const imgHeaders = new Headers(imgRes.headers);
    // 强制缓存图片 1 天，减少重复抓取
    imgHeaders.set('Cache-Control', 'public, s-maxage=86400');
    return new Response(imgRes.body, { headers: imgHeaders });
  }

  // 2. 正常处理页面请求
  const targetUrl = `https://${targetHost}${url.pathname}${url.search}`;
  const res = await fetch(targetUrl, {
    headers: { 'host': targetHost, 'referer': `https://${targetHost}/` }
  });

  const headers = new Headers(res.headers);
  
  // --- 【关键逻辑 1：解决 MISS 问题】 ---
  // 必须删掉 Set-Cookie，否则 Vercel 绝不会缓存
  headers.delete('Set-Cookie'); 
  headers.delete('Pragma');
  // 强制服务器缓存 HTML 成品
  headers.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=600');

  if (headers.get('content-type')?.includes('text/html')) {
    let text = await res.text();
    
    // --- 【关键逻辑 2：服务器端破解懒加载】 ---
    // 发货前直接将 data-src 暴力替换成 src
    text = text.replace(/data-src="https:\/\//g, `src="https://${myHost}/_img_proxy_/`)
               .replace(/data-original="https:\/\//g, `src="https://${myHost}/_img_proxy_/`)
               .replace(/src="https:\/\/img\.manwa\.me/g, `src="https://${myHost}/_img_proxy_/img.manwa.me`);
    
    // --- 【关键逻辑 3：全域名替换】 ---
    text = text.split(targetHost).join(myHost);
    
    return new Response(text, { headers });
  }

  return new Response(res.body, { headers });
}
