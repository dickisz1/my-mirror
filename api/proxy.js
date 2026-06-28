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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8秒超时,别让死链接卡住队列

    const response = await fetch(targetUrl, {
      method: req.method,
      headers: newHeaders,
      redirect: 'manual',
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const resHeaders = new Headers();
    response.headers.forEach((v, k) => resHeaders.set(k, v));

    const contentTypeForCache = resHeaders.get('content-type') || '';
    const isStaticAsset = /image|font|javascript|css/.test(contentTypeForCache);

    if (isStaticAsset) {
      // 静态资源:允许浏览器和 Vercel 边缘节点长期缓存,大幅提速
      // 文件名带 ?v= 版本号的话,内容变了链接也会变,所以长缓存很安全
      resHeaders.set('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
    } else {
      // 只有 HTML 主文档需要每次都拿最新内容(因为要动态注入去广告CSS)
      resHeaders.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0');
      resHeaders.set('Pragma', 'no-cache');
    }

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

      // === 新增:自动加载下一章脚本,实现无缝阅读 ===
      const autoLoadScript = `
      <script>
      document.addEventListener('DOMContentLoaded', function() {
        var nextLink = document.querySelector('a.view-fix-bottom-bar-item-menu-next');
        var container = document.querySelector('#cp_img.view-main-1');
        if (!nextLink || !container) return;

        var loading = false;
        var sentinel = document.createElement('div');
        sentinel.id = '__auto_load_sentinel__';
        sentinel.style.height = '1px';
        container.parentNode.insertBefore(sentinel, container.nextSibling);

        function loadNextChapter() {
          if (loading) return;
          var href = nextLink.getAttribute('href');
          if (!href || href === 'javascript:;' || href === '#') return;
          loading = true;

          // 用隐藏 iframe 加载下一章,让它的 JS 真正执行,
          // 这样懒加载逻辑才会把真实图片地址换进去(而不是占位图)
          var iframe = document.createElement('iframe');
          iframe.style.position = 'fixed';
          iframe.style.left = '-99999px';
          iframe.style.top = '0';
          iframe.style.width = '800px';
          // 故意给一个超大高度,让所有图片"一开始就在可视区域内",
          // 这样依赖 IntersectionObserver 的懒加载库会一次性把所有图片都加载出来,
          // 不需要我们模拟滚动
          iframe.style.height = '30000px';
          iframe.style.border = 'none';
          iframe.src = href;
          document.body.appendChild(iframe);

          var settled = false;
          function finish() {
            if (settled) return;
            settled = true;

            try {
              var idoc = iframe.contentDocument;
              var nextContainer = idoc.querySelector('#cp_img.view-main-1');
              var nextNextLink = idoc.querySelector('a.view-fix-bottom-bar-item-menu-next');

              if (nextContainer) {
                var divider = document.createElement('div');
                divider.textContent = '— 已自动加载下一章 —';
                divider.style.textAlign = 'center';
                divider.style.color = '#999';
                divider.style.padding = '16px 0';
                container.appendChild(divider);

                var imgs = nextContainer.querySelectorAll('img.content-img');
                imgs.forEach(function(img){
                  // 优先取真正生效的 src(JS跑完后应该已经是真实地址),
                  // 如果还是占位图/blob,再退而取 data-original
                  var real = img.src;
                  if (!real || real.indexOf('blob:') === 0 || real.indexOf('imagecover3') !== -1) {
                    real = img.getAttribute('data-original') || real;
                  }
                  if (!real || real.indexOf('blob:') === 0) return;
                  var newImg = document.createElement('img');
                  newImg.src = real;
                  newImg.className = 'content-img auto-loaded-img';
                  newImg.style.display = 'block';
                  newImg.style.width = '100%';
                  container.appendChild(newImg);
                });
              }

              if (nextNextLink) {
                nextLink.setAttribute('href', nextNextLink.getAttribute('href'));
              } else {
                nextLink.setAttribute('href', '');
              }
              history.pushState(null, '', href);
            } catch (e) {
              console.error('读取下一章iframe内容失败:', e);
            }

            document.body.removeChild(iframe);
            container.parentNode.insertBefore(sentinel, container.nextSibling);
            loading = false;
          }

          iframe.onload = function() {
            // 给页面JS留出时间执行懒加载替换逻辑,1.5秒后再去读取结果
            // 如果发现图片还是没换成真实地址,可以把这个数字调大试试
            setTimeout(finish, 1500);
          };

          // 兜底:如果 iframe 一直不触发 onload(网络问题等),8秒后强制结束,避免卡死
          setTimeout(finish, 8000);
        }

        var observer = new IntersectionObserver(function(entries){
          entries.forEach(function(entry){
            if (entry.isIntersecting) loadNextChapter();
          });
        }, { rootMargin: '600px' });

        observer.observe(sentinel);
      });
      </script>`;
      text = text.replace('</body>', `${autoLoadScript}</body>`);

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

    // JS 文件里有时会硬编码图片真实域名(比如章节数据脚本),同样需要替换
    if (contentTypeForCache.includes('javascript')) {
      let js = await response.text();
      js = js
        .split(`https://${ASSET_HOST}`).join(`https://${myHost}${ASSET_PREFIX}`)
        .split(`//${ASSET_HOST}`).join(`//${myHost}${ASSET_PREFIX}`)
        .split(targetHost).join(myHost);
      return new Response(js, {
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
