export const config = {
  runtime: 'edge',
};

const ASSET_HOST = "mwappimgs.cc";
const ASSET_PREFIX = "/__assets__";

export default async function handler(req) {
  const targetHost = "manwa.me";
  const url = new URL(req.url);
  const myHost = url.host;

  // 1. 请求路由判断
  let realTargetHost = targetHost;
  let realPath = url.pathname;

  if (url.pathname.startsWith(ASSET_PREFIX)) {
    realTargetHost = ASSET_HOST;
    realPath = url.pathname.slice(ASSET_PREFIX.length) || "/";
  }

  const targetUrl = `https://${realTargetHost}${realPath}${url.search}`;

  // 2. 修正请求头
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

    const resHeaders = new Headers(response.headers);
    const contentType = resHeaders.get('content-type') || '';

    // 3. 缓存策略
    if (/image|font|javascript|css/.test(contentType)) {
      resHeaders.set('Cache-Control', 'public, max-age=86400, s-maxage=604800');
    } else {
      resHeaders.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    }

    // 4. 内容处理
    if (contentType.includes('text/html') || contentType.includes('javascript') || contentType.includes('text/css')) {
      let text = await response.text();

      // 翻译清单：把所有原站链接翻译成你的代理链接
      const replacements = [
        { from: `https://${ASSET_HOST}`, to: `https://${myHost}${ASSET_PREFIX}` },
        { from: `//${ASSET_HOST}`, to: `//${myHost}${ASSET_PREFIX}` },
        { from: `src="https://${ASSET_HOST}`, to: `src="https://${myHost}${ASSET_PREFIX}` },
        { from: `data-original="https://${ASSET_HOST}`, to: `data-original="https://${myHost}${ASSET_PREFIX}` },
        { from: `data-r-src="https://${ASSET_HOST}`, to: `data-r-src="https://${myHost}${ASSET_PREFIX}` },
        { from: `data-src="https://${ASSET_HOST}`, to: `data-src="https://${myHost}${ASSET_PREFIX}` }
      ];

      replacements.forEach(item => {
        text = text.split(item.from).join(item.to);
      });
      text = text.split(targetHost).join(myHost);

      // 如果是 HTML，注入去广告 CSS 和自动加载脚本
      if (contentType.includes('text/html')) {
        const adShield = `<style>a[href][target][rel][style],div.footer-float-icon,img.return-top{display:none!important;}</style>`;
        text = text.replace('</head>', `${adShield}</head>`);
        
        // 自动加载脚本保持不变...
        // (此处省略你原有的 autoLoadScript 代码，请保持原样粘贴)
      }

      return new Response(text, { status: response.status, headers: resHeaders });
    }

    // 5. 二进制资源直接透传
    return new Response(response.body, { status: response.status, headers: resHeaders });

  } catch (err) {
    return new Response("Proxy Error: " + err.message, { status: 502 });
  }
}
