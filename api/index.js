export const config = { runtime: 'edge' }

/* ======== 站点配置 ======== */
const SITE = {
  host: 'manwa.me',
  referer: 'https://manwa.me/',
  imageAttrs: ['data-src', 'data-original', 'src'],

  cache: {
    // 页面缓存：让 Vercel 在内存存 2 小时，过期后先给旧数据后台更新
    html: 'public, s-maxage=7200, stale-while-revalidate=86400',
    // 图片缓存：存 7 天
    image: 'public, s-maxage=604800, immutable'
  }
}

/* ======== 入口 ======== */
export default async function handler(req) {
  const url = new URL(req.url)

  // 路由分发：图片走代理，HTML 走抓取
  if (url.pathname.startsWith('/_img_proxy_/')) {
    return proxyImage(url)
  }

  return proxyHtml(url)
}

/* ======== HTML 代理 ======== */
async function proxyHtml(url) {
  const targetUrl = `https://${SITE.host}${url.pathname}${url.search}`

  const res = await fetch(targetUrl, {
    headers: {
      'host': SITE.host,
      'referer': SITE.referer,
      'cookie': '' // 【书源思维】永远不发送用户状态，确保存储的是干净的成品
    }
  })

  const headers = new Headers(res.headers)

  // —— 解决 MISS 问题的关键逻辑 —— //
  headers.delete('set-cookie') // 彻底杀掉 PHPSESSID，解除缓存限制
  headers.delete('vary')       // 移除 Vary 头，防止因用户代理不同导致缓存失效
  headers.delete('pragma')
  headers.set('cache-control', SITE.cache.html)

  // 非 HTML 资源不处理
  if (!headers.get('content-type')?.includes('text/html')) {
    return new Response(res.body, { status: res.status, headers })
  }

  let html = await res.text()

  // 【书源预处理】在服务器端把懒加载属性直接转成走代理的 src
  html = normalizeImages(html, url.host)
  // 全局域名替换
  html = html.split(SITE.host).join(url.host)

  return new Response(html, { status: 200, headers })
}

/* ======== 图片代理 ======== */
async function proxyImage(url) {
  const imgUrl = url.pathname.replace('/_img_proxy_/', 'https://')

  const res = await fetch(imgUrl, {
    headers: { 'referer': SITE.referer }
  })

  const headers = new Headers(res.headers)
  headers.delete('set-cookie') // 图片响应也不允许带 Cookie
  headers.set('cache-control', SITE.cache.image)

  return new Response(res.body, { headers })
}

/* ======== 图片书源化逻辑 ======== */
function normalizeImages(html, myHost) {
  const attrs = SITE.imageAttrs.join('|')
  // 匹配 data-src, data-original 等，强行转换为 src 代理地址
  const reg = new RegExp(`(${attrs})="https://([^"]+)"`, 'g')

  return html.replace(reg, (_, __, path) =>
    `src="https://${myHost}/_img_proxy_/${path}"`
  )
}
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
