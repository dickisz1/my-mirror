export const config = { runtime: 'edge' }

const SITE = {
  host: 'manwa.me',
  referer: 'https://manwa.me/',
  imageAttrs: ['data-src', 'data-original', 'src'],
  cache: {
    html: 'public, s-maxage=7200, stale-while-revalidate=86400',
    image: 'public, s-maxage=604800, immutable'
  }
}

export default async function handler(req) {
  const url = new URL(req.url)
  const myHost = url.host

  if (url.pathname.startsWith('/_img_proxy_/')) {
    return proxyImage(url)
  }

  const targetUrl = `https://${SITE.host}${url.pathname}${url.search}`
  const res = await fetch(targetUrl, {
    headers: {
      'host': SITE.host,
      'referer': SITE.referer,
      'cookie': '' // 书源思维：请求时不带 cookie，确保存储的是公共成品
    }
  })

  const headers = new Headers(res.headers)

  // —— 核心冲突处理：为了 HIT 缓存，我们必须删除 Set-Cookie —— //
  // 如果你一定要保留登录功能，就无法实现“刷新第二次在内存读取”
  headers.delete('set-cookie') 
  headers.delete('vary')
  headers.set('cache-control', SITE.cache.html)

  if (!headers.get('content-type')?.includes('text/html')) {
    return new Response(res.body, { status: res.status, headers })
  }

  let text = await res.text()

  // 1. 注入去广告 CSS
  const adShield = `
    <style>
      a[href][target][rel][style], div.footer-float-icon, i.fas.fa-times, img.return-top,
      img[src][loading], div:nth-of-type(1) > a > input, div:nth-of-type(2) > a > input,
      div:nth-of-type(2) > div:nth-of-type(2) > div, div:nth-of-type(3) > a > input {
        display: none !important; opacity: 0 !important; position: absolute !important; top: -9999px !important;
      }
    </style>`
  text = text.replace('</head>', `${adShield}</head>`)

  // 2. 图片成品化（书源思维：暴力破解懒加载）
  const attrs = SITE.imageAttrs.join('|')
  const reg = new RegExp(`(${attrs})="https://([^"]+)"`, 'g')
  text = text.replace(reg, (_, __, path) => `src="https://${myHost}/_img_proxy_/${path}"`)

  // 3. 域名替换
  text = text.split(SITE.host).join(myHost)

  return new Response(text, { status: 200, headers })
}

async function proxyImage(url) {
  const imgUrl = url.pathname.replace('/_img_proxy_/', 'https://')
  const res = await fetch(imgUrl, { headers: { 'referer': SITE.referer } })
  const headers = new Headers(res.headers)
  headers.delete('set-cookie')
  headers.set('cache-control', SITE.cache.image)
  return new Response(res.body, { headers })
}
