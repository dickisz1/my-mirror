export const config = { runtime: 'edge' };

/* ======== 站点核心配置 ======== */
const SITE = {
  host: 'manwa.me',
  referer: 'https://manwa.me/',
  imageAttrs: ['data-src', 'data-original', 'src'],
  cache: {
    // 页面成品在 Vercel 边缘节点缓存 2 小时
    html: 'public, s-maxage=7200, stale-while-revalidate=86400',
    // 图片在边缘节点缓存 7 天
    image: 'public, s-maxage=604800, immutable'
  }
};

export default async function handler(req) {
  const url = new URL(req.url);
  const myHost = url.host;

  // 1. 路由分发：处理图片代理（解决手机端 Pending 堵塞）
  if (url.pathname.startsWith('/_img_proxy_/')) {
    return proxyImage(url);
  }

  // 2. 抓取目标 HTML（书源模式：不带任何 Cookie）
  const targetUrl = `https://${SITE.host}${url.pathname}${url.search}`;
  const res = await fetch(targetUrl, {
    headers: {
      'host': SITE.host,
      'referer': SITE.referer,
      'cookie': '' // 彻底断开登录态，确保存储的是“公共成品”
    }
  });

  const headers = new Headers(res.headers);

  // 3. 【核心优化】清除干扰缓存的所有标头，实现 100% HIT
  headers.delete('set-cookie'); // 解决你截图中看到的 MISS 问题
  headers.delete('vary');       // 防止因手机型号不同导致缓存失效
  headers.delete('pragma');
  headers.set('cache-control', SITE.cache.html);

  // 如果是非 HTML 资源，直接返回
  if (!headers.get('content-type')?.includes('text/html')) {
    return new Response(res.body, { status: res.status, headers });
  }

  let text = await res.text();

  // 4. 【去广告注入】轻量化 CSS，减少手机 CPU 渲染负担
  const adShield = `
    <style>
      /* 隐藏广告容器和弹窗 */
      a[href][target][rel][style], .footer-float-icon, i.fas.fa-times, 
      img.return-top, div[style*="position: fixed"],
      div:nth-of-type(1) > a > input, div:nth-of-type(2) > a > input { 
        display: none !important; opacity: 0 !important; pointer-events: none !important; 
      }
      /* 优化手机端图片排版 */
      img { max-width: 100% !important; height: auto !important; }
    </style>`;
  text = text.replace('</head>', `${adShield}</head>`);

  // 5. 【书源预处理】服务器端暴力破解懒加载，解决手机端图片排队问题
  const attrs = SITE.imageAttrs.join('|');
  const reg = new RegExp(`(${attrs})="https://([^"]+)"`, 'g');
  text = text.replace(reg, (_, __, path) => `src="https://${myHost}/_img_proxy_/${path}"`);

  // 6. 全域名替换
  const finalHtml = text.split(SITE.host).join(myHost);

  return new Response(finalHtml, { status: 200, headers });
}

/* ======== 图片代理函数 ======== */
async function proxyImage(url) {
  const imgUrl = url.pathname.replace('/_img_proxy_/', 'https://');
  const res = await fetch(imgUrl, {
    headers: { 'referer': SITE.referer }
  });

  const headers = new Headers(res.headers);
  // 确保图片也不会因为原站返回的 Set-Cookie 导致无法缓存
  headers.delete('set-cookie');
  headers.set('cache-control', SITE.cache.image);

  return new Response(res.body, { headers });
}
