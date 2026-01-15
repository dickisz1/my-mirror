export const config = { runtime: 'edge' };

export default async function handler(req) {
  const targetHost = "manwa.me";
  const url = new URL(req.url);
  const targetUrl = `https://${targetHost}${url.pathname}${url.search}`;

  const res = await fetch(targetUrl, {
    headers: { 'host': targetHost, 'referer': `https://${targetHost}/` }
  });

  const headers = new Headers(res.headers);
  
  // --- 【关键修正：杀掉 Cookie 封印】 ---
  headers.delete('Set-Cookie'); 
  headers.delete('Pragma');
  
  // 强制服务器缓存成品 1 小时
  headers.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=600');

  if (headers.get('content-type')?.includes('text/html')) {
    let text = await res.text();
    
    // 暴力破解懒加载：把 data-src 直接换成 src
    text = text.replace(/data-src=/g, 'src=').replace(/data-original=/g, 'src=');
    
    // 域名替换
    text = text.split(targetHost).join(url.host);
    
    return new Response(text, { headers });
  }

  return new Response(res.body, { headers });
}
