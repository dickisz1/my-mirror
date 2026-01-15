export const config = {
  runtime: 'edge', // 使用边缘运行时以获得最佳连接速度
};

export default async function handler(req) {
  const targetHost = "manwa.me";
  const url = new URL(req.url);
  const myHost = url.host;
  const targetUrl = `https://${targetHost}${url.pathname}${url.search}`;

  // 1. 克隆并修正请求头
  const newHeaders = new Headers();
  req.headers.forEach((value, key) => {
    if (key.toLowerCase() !== 'host') {
      newHeaders.set(key, value.replace(new RegExp(myHost, 'g'), targetHost));
    }
  });

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: newHeaders,
      redirect: 'manual' 
    });

    // 2. 构造响应头，并【强制取消缓存】
    const resHeaders = new Headers();
    response.headers.forEach((v, k) => resHeaders.set(k, v));

    // --- 核心修改：取消缓存指令 ---
    // no-cache: 每次都验证
    // no-store: 不允许存储在任何本地或服务器缓存中
    // s-maxage=0: 告诉 Vercel 节点立即过期
    resHeaders.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0');
    resHeaders.set('Pragma', 'no-cache'); // 兼容旧版协议

    // 3. 处理 Cookie
    const setCookies = response.headers.getSetCookie();
    resHeaders.delete('set-cookie');
    setCookies.forEach(cookie => {
      const cleanCookie = cookie
        .replace(/Domain=[^;]+;?/gi, "")
        .replace(new RegExp(targetHost, 'g'), myHost);
      resHeaders.append('Set-Cookie', cleanCookie);
    });

    const contentType = resHeaders.get('content-type') || '';
    if (contentType.includes('text/html')) {
      let text = await response.text();
      
      // 4. 注入你提供的去广告 CSS 规则
      const adShield = `
      <style>
        a[href][target][rel][style], 
        div.footer-float-icon, 
        i.fas.fa-times, 
        img.return-top,
        img[src][loading],
        div:nth-of-type(1) > a > input,
        div:nth-of-type(2) > a > input,
        div:nth-of-type(2) > div:nth-of-type(2) > div,
        div:nth-of-type(3) > a > input {
          display: none !important;
          opacity: 0 !important;
          position: absolute !important;
          top: -9999px !important;
        }
      </style>`;

      // 将去广告规则注入到 head
      text = text.replace('</head>', `${adShield}</head>`);

      return new Response(text.split(targetHost).join(myHost), {
        status: response.status,
        headers: resHeaders
      });
    }

    // 5. 非 HTML 内容（如图片）也取消缓存，直接返回
    return new Response(response.body, {
      status: response.status,
      headers: resHeaders
    });

  } catch (err) {
    return new Response("Edge Proxy Error: " + err.message, { status: 502 });
  }
}
