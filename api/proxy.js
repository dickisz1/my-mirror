export const config = {
  runtime: 'edge', // 使用边缘运行时以获得最佳连接速度
  runtime: 'edge',
};

// 新增:定义需要一起代理的资源域名(图片/CSS 等)
const ASSET_HOST = "mwappimgs.cc";
const ASSET_PREFIX = "/__assets__"; // 用一个特殊路径前缀来区分"这是要转发给图片域名的请求"

export default async function handler(req) {
  const targetHost = "manwa.me";
  const url = new URL(req.url);
  const myHost = url.host;
  const targetUrl = `https://${targetHost}${url.pathname}${url.search}`;

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
      newHeaders.set(key, value.replace(new RegExp(myHost, 'g'), targetHost));
      newHeaders.set(key, value.replace(new RegExp(myHost, 'g'), realTargetHost));
    }
  });

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: newHeaders,
      redirect: 'manual' 
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
    resHeaders.set('Pragma', 'no-cache');

    // 3. 处理 Cookie
    const setCookies = response.headers.getSetCookie();
    resHeaders.delete('set-cookie');
    setCookies.forEach(cookie => {
      const cleanCookie = cookie
        .replace(/Domain=[^;]+;?/gi, "")
        .replace(new RegExp(targetHost, 'g'), myHost);
        .replace(new RegExp(realTargetHost, 'g'), myHost);
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
        a[href][target][rel][style],
        div.footer-float-icon,
        i.fas.fa-times,
        img.return-top,
        img[src][loading],
        div:nth-of-type(1) > a > input,
@@ -66,17 +74,33 @@ export default async function handler(req) {
          top: -9999px !important;
        }
      </style>`;

      // 将去广告规则注入到 head
      text = text.replace('</head>', `${adShield}</head>`);

      return new Response(text.split(targetHost).join(myHost), {
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

    // 5. 非 HTML 内容（如图片）也取消缓存，直接返回
    // 图片等二进制内容,直接转发,不需要文本替换
    return new Response(response.body, {
      status: response.status,
      headers: resHeaders
