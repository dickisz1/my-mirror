export const config = { runtime: 'edge' };

export default async function handler(req) {
  const targetHost = "manwa.me";
  const url = new URL(req.url);
  const myHost = url.host;
  const targetUrl = `https://${targetHost}${url.pathname}${url.search}`;

  const newHeaders = new Headers(req.headers);
  newHeaders.set('host', targetHost);
  newHeaders.set('referer', `https://${targetHost}/`);

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: newHeaders,
    });

    const resHeaders = new Headers(response.headers);
    const contentType = resHeaders.get('content-type') || '';

    // 【关键点 1】告诉 Vercel 节点：把这个成品存起来！
    // s-maxage=3600 意味着服务器会把处理好的成品存 1 小时
    if (response.status === 200) {
      resHeaders.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    }

    if (contentType.includes('text/html')) {
      // 【关键点 2】在服务器端就把所有“懒加载”代码改掉
      let text = await response.text();
      
      // 暴力破解懒加载：直接把 data-src 替换成 src
      // 这样图片在发给手机前，已经是“待加载”状态，不需要等 JS 运行
      text = text.replace(/data-src=/g, 'src=')
                 .replace(/data-original=/g, 'src=');

      // 暴力去广告：直接在服务器端删除广告链接
      text = text.replace(/<script\b[^>]*>([\s\S]*?)adsterra[\s\S]*?<\/script>/gmi, '')
                 .replace(new RegExp(targetHost, 'g'), myHost);

      return new Response(text, { 
        status: 200, 
        headers: resHeaders 
      });
    }

    return new Response(response.body, { status: response.status, headers: resHeaders });

  } catch (err) {
    return new Response("Server Error", { status: 500 });
  }
}
