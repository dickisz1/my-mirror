export const config = { runtime: 'edge' };

export default async function handler(req) {
  const targetHost = "manwa.me";
  const url = new URL(req.url);
  const myHost = url.host;

  // 1. 图片中转逻辑：解决“待处理”卡顿
  if (url.pathname.startsWith('/_img_proxy_/')) {
    const actualImageUrl = url.pathname.replace('/_img_proxy_/', 'https://');
    const imgRes = await fetch(actualImageUrl, {
      headers: { 'referer': `https://${targetHost}/` }
    });
    const imgHeaders = new Headers(imgRes.headers);
    imgHeaders.set('Cache-Control', 'public, s-maxage=86400');
    return new Response(imgRes.body, { headers: imgHeaders });
  }

  // 2. 抓取目标页面
  const targetUrl = `https://${targetHost}${url.pathname}${url.search}`;
  const res = await fetch(targetUrl, {
    headers: { 
      'host': targetHost, 
      'referer': `https://${targetHost}/`,
      // 不向原站发送你的 Cookie，保持请求“干净”
      'cookie': '' 
    }
  });

  const headers = new Headers(res.headers);
  
  // --- 【关键修改：彻底抛弃登录信息】 ---
  // 无论原站发回什么 Cookie，全部删掉，不给浏览器，也不给 Vercel 看到
  headers.delete('Set-Cookie'); 
  headers.delete('Pragma');
  
  // 强制开启服务器级缓存：告诉 Vercel 这是一个公共成品
  headers.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=600');

  if (headers.get('content-type')?.includes('text/html')) {
    let text = await res.text();
    
    // 服务器端直接破解懒加载：把 data-src 替换为走代理的 src
    text = text.replace(/data-src="https:\/\//g, `src="https://${myHost}/_img_proxy_/`)
               .replace(/data-original="https:\/\//g, `src="https://${myHost}/_img_proxy_/`)
               .replace(/src="https:\/\/img\.manwa\.me/g, `src="https://${myHost}/_img_proxy_/img.manwa.me`);
    
    // 全局域名替换
    text = text.split(targetHost).join(myHost);
    
    return new Response(text, { headers });
  }

  return new Response(res.body, { headers });
}
