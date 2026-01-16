export const config = { runtime: 'edge' };

export default async function handler(req) {
  const targetHost = "manwa.me";
  const url = new URL(req.url);
  const myHost = url.host;

  // 1. 核心抓取逻辑：如果路径包含 _img_proxy_，则中转图片
  if (url.pathname.startsWith('/_img_proxy_/')) {
    const actualImageUrl = url.pathname.replace('/_img_proxy_/', 'https://');
    const imgRes = await fetch(actualImageUrl, {
      headers: { 'referer': `https://${targetHost}/` }
    });
    const imgHeaders = new Headers(imgRes.headers);
    // 强制缓存图片 1 天
    imgHeaders.set('Cache-Control', 'public, s-maxage=86400');
    return new Response(imgRes.body, { headers: imgHeaders });
  }

  // 2. 模拟书源请求：强制不带 Cookie 去抓取 HTML
  const targetUrl = `https://${targetHost}${url.pathname}${url.search}`;
  const res = await fetch(targetUrl, {
    headers: { 
      'host': targetHost, 
      'referer': `https://${targetHost}/`,
      'cookie': '' // 彻底切断登录关联，让服务器敢于缓存
    }
  });

  const headers = new Headers(res.headers);
  // 3. 【解决 MISS】清理所有可能导致缓存失效的头
  headers.delete('Set-Cookie'); 
  headers.delete('Vary');
  headers.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=600');

  if (headers.get('content-type')?.includes('text/html')) {
    let text = await res.text();

    // 4. 【书源式提取】暴力将所有懒加载图片替换为直接加载的代理地址
    // 匹配 data-src 或 data-original，将其转换为成品 src
    text = text.replace(/(data-src|data-original|src)="https:\/\/([^"]+)"/g, (match, p1, p2) => {
      return `src="https://${myHost}/_img_proxy_/${p2}"`;
    });

    // 5. 注入“成品化”增强脚本（可选，用于极致去广告）
    const injectCss = `<style>a[href*="adsterra"], .ad-box, [id*="ad-"] { display:none!important; }</style>`;
    text = text.replace('</head>', `${injectCss}</head>`);

    // 6. 全域名替换
    const body = text.split(targetHost).join(myHost);
    
    return new Response(body, { status: 200, headers });
  }

  return new Response(res.body, { status: res.status, headers });
}
