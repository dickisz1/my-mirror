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

    // 【成品化步骤 1】强制 Vercel 存储这个处理好的成品
    if (response.status === 200) {
      // 存储 1 小时，即使过期了也先给用户看旧的(秒开)，后台再更新
      resHeaders.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    }

    if (contentType.includes('text/html')) {
      let text = await response.text();
      
      // 【成品化步骤 2】在服务器端直接破解懒加载
      // 把所有 data-src 直接换成 src，这样手机拿到网页时，图片就已经在加载了
      text = text.replace(/data-src=/g, 'src=')
                 .replace(/data-original=/g, 'src=');

      // 【成品化步骤 3】服务器端全域名替换
      text = text.split(targetHost).join(myHost);

      return new Response(text, { status: 200, headers: resHeaders });
    }

    return new Response(response.body, { status: response.status, headers: resHeaders });
  } catch (err) {
    return new Response("Server Error", { status: 500 });
  }
}
