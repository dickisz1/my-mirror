export const config = {
  runtime: 'edge',
};

// 定义代理资源域名
const ASSET_HOST = "mwappimgs.cc";
const ASSET_PREFIX = "/__assets__";

export default async function handler(req) {
  const targetHost = "manwari.cc";
  const url = new URL(req.url);
  const myHost = url.host;

  let realTargetHost = targetHost;
  let realPath = url.pathname;

  if (url.pathname.startsWith(ASSET_PREFIX)) {
    realTargetHost = ASSET_HOST;
    realPath = url.pathname.slice(ASSET_PREFIX.length) || "/";
  }

  const targetUrl = `https://${realTargetHost}${realPath}${url.search}`;

  // 1. 克隆并修正请求头（保持完整的 Content-Type 等 Header 透传，解决 500 报错）
  const newHeaders = new Headers();
  req.headers.forEach((value, key) => {
    if (key.toLowerCase() !== 'host') {
      newHeaders.set(key, value.replace(new RegExp(myHost, 'g'), realTargetHost));
    }
  });

  newHeaders.set('Host', realTargetHost);
  newHeaders.set('Referer', `https://${realTargetHost}/`);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const fetchOptions = {
      method: req.method,
      headers: newHeaders,
      redirect: 'manual',
      signal: controller.signal
    };

    // 针对带 Body 的 POST/PUT 等请求，透传 Body Buffer
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase())) {
      fetchOptions.body = await req.clone().arrayBuffer();
    }

    const response = await fetch(targetUrl, fetchOptions);
    clearTimeout(timeoutId);

    const resHeaders = new Headers();
    response.headers.forEach((v, k) => resHeaders.set(k, v));

    const contentTypeForCache = resHeaders.get('content-type') || '';
    const isStaticAsset = /image|font|javascript|css/.test(contentTypeForCache);

    if (isStaticAsset) {
      resHeaders.set('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
    } else {
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

      // 注入基础样式防护（去广告 + 宽屏适配）
      const adShield = `
      <style>
        a[href][target][rel][style],
        div.footer-float-icon,
        i.fas.fa-times,
        img.return-top,
        img[src][loading]:not(.auto-loaded-img),
        div:nth-of-type(1) > a > input,
        div:nth-of-type(2) > a > input,
        div:nth-of-type(2) > div:nth-of-type(2) > div,
        div:nth-of-type(3) > a > input {
          display: none !important;
          opacity: 0 !important;
          position: absolute !important;
          top: -9999px !important;
        }
        @media (min-width: 600px) {
          .main-content {
            width: 100% !important;
            max-width: 800px !important;
            margin: 0 auto !important;
          }
          #cp_img.view-main-1 img {
            width: 100% !important;
            max-width: 100% !important;
          }
        }
        #cp_img img, #cp_img img.auto-loaded-img {
          image-orientation: none !important;
        }
      </style>`;
      text = text.replace('</head>', `${adShield}</head>`);
      // 注入白名单物理剪枝与 DOM 沙盒防护脚本
      const domWhitelistSandbox = `
      <script>
        (function applyDOMWhitelistSandbox() {
          const ALLOWED_SELECTORS = [
            '#mescroll',
            '.cm-topbar',
            '.cate-box',
            '.cm-tabs',
            '.bm-box',
            '.center-tabs',
            '.item',
            '.clearfix',
            'script',
            'style',
            'link'
          ];

          function isAllowedNode(node) {
            if (node.nodeType !== Node.ELEMENT_NODE) return true;
            return ALLOWED_SELECTORS.some(sel => {
              try {
                return node.matches(sel) || node.querySelector(sel) !== null || node.closest(sel) !== null;
              } catch (e) {
                return false;
              }
            });
          }

          function performPhysicalPruning() {
            const mescroll = document.querySelector('#mescroll');
            if (mescroll) {
              // 第一重：body 直属层级隔离，抹除非白名单节点
              Array.from(document.body.children).forEach(child => {
                if (child !== mescroll && !['SCRIPT', 'STYLE', 'LINK'].includes(child.tagName)) {
                  child.remove();
                }
              });

              // 第二重：#mescroll 内部非白名单垃圾节点清理
              const internalNodes = mescroll.querySelectorAll('*');
              internalNodes.forEach(node => {
                if (!isAllowedNode(node)) {
                  node.remove();
                }
              });
            }
          }

          // 页面加载完成后立即物理剪枝
          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', performPhysicalPruning);
          } else {
            performPhysicalPruning();
          }

          // 挂载 MutationObserver，拦截 AJAX 翻页或异步脚本动态复活的广告
          const observer = new MutationObserver(mutations => {
            const mescroll = document.querySelector('#mescroll');
            mutations.forEach(mutation => {
              mutation.addedNodes.forEach(node => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                  if (node.parentNode === document.body && node !== mescroll && !['SCRIPT', 'STYLE'].includes(node.tagName)) {
                    node.remove();
                    return;
                  }
                  if (mescroll && mescroll.contains(node) && !isAllowedNode(node)) {
                    node.remove();
                  }
                }
              });
            });
          });

          observer.observe(document.body, { childList: true, subtree: true });
        })();
      </script>`;

      text = text.replace('</body>', `${domWhitelistSandbox}</body>`);

      // 域名重写与资源路径映射
      text = text.replace(new RegExp(`https://${ASSET_HOST}`, 'g'), ASSET_PREFIX);
      text = text.replace(new RegExp(`https://${targetHost}`, 'g'), `https://${myHost}`);

      resHeaders.delete('content-length');
      resHeaders.set('content-type', 'text/html; charset=utf-8');

      return new Response(text, {
        status: response.status,
        headers: resHeaders
      });
    }

    // 针对 JSON 或其他文本接口，补充域名重写
    if (contentType.includes('application/json') || contentType.includes('text/plain')) {
      let jsonText = await response.text();
      jsonText = jsonText.replace(new RegExp(`https://${targetHost}`, 'g'), `https://${myHost}`);
      resHeaders.delete('content-length');
      return new Response(jsonText, {
        status: response.status,
        headers: resHeaders
      });
    }

    return new Response(response.body, {
      status: response.status,
      headers: resHeaders
    });

  } catch (err) {
    return new Response(`Edge Proxy Error: ${err.message}`, { status: 502 });
  }
}
