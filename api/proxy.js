export const config = {
  runtime: 'edge',
};

// 新增:定义需要一起代理的资源域名(图片/CSS 等)
const ASSET_HOST = "mwappimgs.cc";
const ASSET_PREFIX = "/__assets__"; // 用一个特殊路径前缀来区分"这是要转发给图片域名的请求"

export default async function handler(req) {
  const targetHost = "manwa.me";
  const url = new URL(req.url);
  const myHost = url.host;

  // === 新增逻辑:判断这次请求是不是冲着图片域名来的 ===
  let realTargetHost = targetHost;
  let realPath = url.pathname;

  if (url.pathname.startsWith(ASSET_PREFIX)) {
    realTargetHost = ASSET_HOST;
    realPath = url.pathname.slice(ASSET_PREFIX.length) || "/";
  }

  const targetUrl = `https://${realTargetHost}${realPath}${url.search}`;

  // 1. 克隆并修正请求头
  const newHeaders = new Headers();
  req.headers.forEach((value, key) => {
    if (key.toLowerCase() !== 'host') {
      newHeaders.set(key, value.replace(new RegExp(myHost, 'g'), realTargetHost));
    }
  });

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: newHeaders,
      redirect: 'manual'
    });

    const resHeaders = new Headers();
    response.headers.forEach((v, k) => resHeaders.set(k, v));

    resHeaders.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0');
    resHeaders.set('Pragma', 'no-cache');

    const setCookies = response.headers.getSetCookie();
    resHeaders.delete('set-cookie');
    setCookies.forEach(cookie => {
      const cleanCookie = cookie
        .replace(/Domain=[^;]+;?/gi, "")
        .replace(new RegExp(realTargetHost, 'g'), myHost);
      resHeaders.append('Set-Cookie', cleanCookie);
    });

    const contentType = resHeaders.get('content-type') || '';

    if (contentType.includes('text/html')) {
      let text = await response.text();

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
      text = text.replace('</head>', `${adShield}</head>`);

      // === 新增:把 HTML 里所有指向图片域名的链接,改写成走我们自己的 /__assets__ 前缀 ===
      text = text
        .split(`https://${ASSET_HOST}`).join(`https://${myHost}${ASSET_PREFIX}`)
        .split(`//${ASSET_HOST}`).join(`//${myHost}${ASSET_PREFIX}`)
        .split(targetHost).join(myHost);

      return new Response(text, {
        status: response.status,
        headers: resHeaders
      });
    }

    // 如果是 CSS,里面可能也有 url(https://mwappimgs.cc/xxx.png) 这种引用,同样要替换
    if (contentType.includes('text/css')) {
      let css = await response.text();
      css = css
        .split(`https://${ASSET_HOST}`).join(`https://${myHost}${ASSET_PREFIX}`)
        .split(`//${ASSET_HOST}`).join(`//${myHost}${ASSET_PREFIX}`);
      return new Response(css, {
        status: response.status,
        headers: resHeaders
      });
    }

    // 图片等二进制内容,直接转发,不需要文本替换
    return new Response(response.body, {
      status: response.status,
      headers: resHeaders
    });

  } catch (err) {
    return new Response("Edge Proxy Error: " + err.message, { status: 502 });
  }
}
