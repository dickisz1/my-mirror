export const config = { runtime: 'edge' }

/**
 * 私人阅读书源代理（最终形态）
 * 设计目标：稳定、低维护、强缓存
 */

/* ======== 站点配置（只改这一块） ======== */

const SITE = {
  host: 'manwa.me',
  referer: 'https://manwa.me/',
  imageAttrs: ['data-src', 'data-original', 'src'],

  cache: {
    html: 'public, s-maxage=7200, stale-while-revalidate=86400',
    image: 'public, s-maxage=604800, immutable'
  }
}

/* ======== 入口 ======== */

export default async function handler(req: Request) {
  const url = new URL(req.url)

  if (url.pathname.startsWith('/_img_proxy_/')) {
    return proxyImage(url)
  }

  return proxyHtml(url)
}

/* ======== HTML 代理 ======== */

async function proxyHtml(url: URL) {
  const targetUrl = `https://${SITE.host}${url.pathname}${url.search}`

  const res = await fetch(targetUrl, {
    headers: {
      host: SITE.host,
      referer: SITE.referer,
      cookie: '' // 永远禁用用户态
    }
  })

  const headers = new Headers(res.headers)

  // —— 强制缓存确定性 —— //
  headers.delete('set-cookie')
  headers.delete('vary')
  headers.set('cache-control', SITE.cache.html)

  // 非 HTML 不处理
  if (!headers.get('content-type')?.includes('text/html')) {
    return new Response(res.body, { status: res.status, headers })
  }

  let html = await res.text()

  html = normalizeImages(html, url.host)
  html = html.split(SITE.host).join(url.host)

  return new Response(html, { status: 200, headers })
}

/* ======== 图片代理 ======== */

async function proxyImage(url: URL) {
  const imgUrl = url.pathname.replace('/_img_proxy_/', 'https://')

  const res = await fetch(imgUrl, {
    headers: { referer: SITE.referer }
  })

  const headers = new Headers(res.headers)
  headers.set('cache-control', SITE.cache.image)

  return new Response(res.body, { headers })
}

/* ======== 图片书源化 ======== */

function normalizeImages(html: string, myHost: string) {
  const attrs = SITE.imageAttrs.join('|')
  const reg = new RegExp(
    `(${attrs})="https://([^"]+)"`,
    'g'
  )

  return html.replace(reg, (_, __, path) =>
    `src="https://${myHost}/_img_proxy_/${path}"`
  )
}
