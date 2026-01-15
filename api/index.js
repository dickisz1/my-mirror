export const config = { runtime: 'edge' };

export default async function handler(req) {
  const targetHost = "manwa.me";
  const url = new URL(req.url);
  const targetUrl = `https://${targetHost}${url.pathname}${url.search}`;

  const res = await fetch(targetUrl, {
    headers: { 'host': targetHost, 'referer': `https://${targetHost}/` }
  });

  const headers = new Headers(res.headers);
  
  // --- 关键修改：清理干扰项 ---
  // 1. 必须删掉 Set-Cookie，否则 Vercel 为了安全绝不会缓存该页面
  headers.delete('Set-Cookie');
  
  // 2. 删掉原站可能存在的私有缓存指令（如 private, no-cache）
  headers.delete('Pragma');
  
  // 3. 强制覆盖缓存指令
  headers.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=600');

  if (headers.get('content-type')?.includes('text/html')) {
    let text = await res.text();
    text = text.split(targetHost).join(url.host);
    
    // 返回处理后的文本
    return new Response(text, { headers });
  }

  // 返回原始流
  return new Response(res.body, { headers });
}
