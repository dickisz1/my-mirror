export const config = { runtime: 'edge' };

export default async function handler(req) {
  const targetHost = "manwa.me";
  const url = new URL(req.url);
  const myHost = url.host;

  // 1. 处理图片代理（解决待处理卡顿）
  if (url.pathname.startsWith('/_img_proxy_/')) {
    const actualImageUrl = url.pathname.replace('/_img_proxy_/', 'https://');
    const imgRes = await fetch(actualImageUrl, {
      headers: { 'referer': `https://${targetHost}/` }
    });
    const imgHeaders = new Headers(imgRes.headers);
    imgHeaders.set('Cache-Control', 'public, s-maxage=86400'); // 图片缓存一天
    return new Response(imgRes.body, { headers: imgHeaders });
  }

  // 2. 抓取 HTML（双向清除 Cookie 确保服务器缓存）
  const targetUrl = `https://${targetHost}${url.pathname}${url.search}`;
  const res = await fetch(targetUrl, {
    headers: { 
      'host': targetHost, 
      'referer': `https://${targetHost}/`,
      'cookie': '' // 【去程阻断】不向原站发送任何登录信息
    }
  });

  // 3. 准备成品响应头
  const headers = new Headers(res.headers);
  
  // 【关键：清理回程所有干扰项】
  headers.delete('Set-Cookie'); 
  headers.delete('Pragma');
  headers.delete('Vary'); // 有些 Vary 头会导致节点缓存失效
  
  // 强行设定服务器级长缓存：1小时成品存储
  headers.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=600');

  if (headers.get('content-type')?.includes('text/html')) {
    let text = await res.text();
    
    // 服务器端暴力替换 data-src
    text = text.replace(/data-src="https:\/\//g, `src="https://${myHost}/_img_proxy_/`)
               .replace(/data-original="https:\/\//g, `src="https://${myHost}/_img_proxy_/`)
               .replace(/src="https:\/\/img\.manwa\.me/g, `src="https://${myHost}/_img_proxy_/img.manwa.me`);
    
    // 全局域名替换
    text = text.split(targetHost).join(myHost);
    
    return new Response(text, { status: 200, headers });
  }

  return new Response(res.body, { status: res.status, headers });
},
