export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  const targetHost = "manwa.me";
  const url = new URL(req.url);
  const myHost = url.host;
  const targetUrl = `https://${targetHost}${url.pathname}${url.search}`;

  const newHeaders = new Headers();
  req.headers.forEach((v, k) => {
    if (k.toLowerCase() !== 'host') {
      newHeaders.set(k, v.replace(new RegExp(myHost, 'g'), targetHost));
    }
  });

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: newHeaders,
      redirect: 'manual'
    });

    const resHeaders = new Headers(response.headers);
    const setCookies = response.headers.getSetCookie();
    resHeaders.delete('set-cookie');
    setCookies.forEach(c => resHeaders.append('Set-Cookie', c.replace(/Domain=[^;]+;?/gi, "").replace(new RegExp(targetHost, 'g'), myHost)));

    if (resHeaders.get('content-type')?.includes('text/html')) {
      let text = await response.text();

      // 注入你提供的精准去广告规则
      const adShield = `
      <style>
        /* 1. 排版保护：限制图标最大尺寸，防止因去广告导致的样式塌陷（解决大喇叭问题） */
        img[src*="notice"], .notice-icon { max-width: 35px !important; height: auto !important; }

        /* 2. 集成你提供的 uBlock 规则 */
        a[href][target][rel][style],                     /* 复杂的链接广告 */
        div.footer-float-icon,                           /* 底部浮动图标 */
        div:nth-of-type(1) > a > input,                  /* 伪装 input 广告 1 */
        div:nth-of-type(2) > a > input,                  /* 伪装 input 广告 2 */
        div:nth-of-type(3) > a > input,                  /* 伪装 input 广告 3 */
        i.fas.fa-times,                                  /* 广告关闭按钮小图标 */
        img.return-top,                                  /* 回到顶部/伪装图标 */
        img[src][loading],                               /* 带有 loading 属性的干扰图 */
        
        /* 补充：常见的通用广告容器 */
        .fixed-ad, .ad-area, [id*="ads"], [class*="ads"] 
        {
          display: none !important;
          visibility: hidden !important;
          pointer-events: none !important;
        }

        /* 3. 基础漫画图片自适应（仅保证能看清） */
        .manga-page img, .comic-img { max-width: 100% !important; height: auto !important; }
      </style>
      <script>
        // 仅保留基础验证提示
        console.log("去广告规则已加载");
      </script>`;

      text = text.replace('</head>', `${adShield}</head>`);
      return new Response(text.split(targetHost).join(myHost), {
        status: response.status,
        headers: resHeaders
      });
    }

    return new Response(response.body, { status: response.status, headers: resHeaders });
  } catch (err) {
    return new Response("Error: " + err.message, { status: 502 });
  }
}
