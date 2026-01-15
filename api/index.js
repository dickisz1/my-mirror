export const config = { runtime: 'edge' };

export default async function handler(req) {
  const targetHost = "manwa.me";
  const url = new URL(req.url);
  const targetUrl = `https://${targetHost}${url.pathname}${url.search}`;

  const res = await fetch(targetUrl, {
    headers: { 'host': targetHost, 'referer': `https://${targetHost}/` }
  });

  const headers = new Headers(res.headers);
  
  // 【最核心一行】：强制 Vercel 缓存这个成品 1 小时 (3600秒)
  // s-maxage 是服务器缓存的关键标识
  headers.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=600');

  // 如果是 HTML，在这里处理完域名替换再返回
  if (headers.get('content-type')?.includes('text/html')) {
    let text = await res.text();
    text = text.split(targetHost).join(url.host);
    return new Response(text, { headers });
  }

  return new Response(res.body, { headers });
}
