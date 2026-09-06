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

    // 全局注入 CORS 支持，消灭二阶图床与资源跨域拦截
    resHeaders.set('Access-Control-Allow-Origin', '*');
    resHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    resHeaders.set('Access-Control-Allow-Headers', '*');

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

      // 1. 优先注入 JS API 劫持防御脚本（在 head 顶部最快生效，彻底封锁移动端 window.open 弹窗与伪造点击）
      const apiShieldScript = `
      <script>
        (function blockMobilePopups() {
          const currentHost = window.location.host;

          // 重写 window.open，强行过滤非本站域名的弹窗（拦截 bgi2282uht.vip:9527 等恶意地址）
          const nativeOpen = window.open;
          window.open = function(url, target, features) {
            if (!url) return null;
            try {
              const targetUrl = new URL(url, window.location.href);
              // 如果跳转的目标域名与当前代理域名不同，且包含非法端口或异域，直接拦截阻断
              if (targetUrl.host !== currentHost) {
                console.warn('[Edge 防护] 已成功拦截跨域移动端强弹外链:', url);
                return null;
              }
            } catch (e) {
              return null;
            }
            return nativeOpen.apply(this, arguments);
          };

          // 防御移动端全局 touchstart/click 事件劫持（拦截注入到 window.location 的强行重定向）
          document.addEventListener('click', function(e) {
            let target = e.target;
            while (target && target !== document.body) {
              if (target.tagName === 'A') {
                const href = target.getAttribute('href');
                if (href && (href.includes('9527') || href.includes('.vip') || href.startsWith('http') && !href.includes(currentHost))) {
                  e.preventDefault();
                  e.stopPropagation();
                  console.warn('[Edge 防护] 已成功拦截移动端触屏点击劫持外链:', href);
                  return false;
                }
              }
              target = target.parentNode;
            }
          }, true);
        })();
      </script>`;

      // 2. 注入 CSS 防护（去广告 + 宽屏适配 + SweetAlert2 全局压制 + 滚动锁死解除）
      const adShield = `
      <style>
        /* 1. 屏蔽指定广告块与悬浮元素 */
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

        /* 2. P0 级修补：强力压制 SweetAlert2 及所有第三方弹窗组件与遮罩层 */
        .swal2-container,
        .swal2-popup,
        .swal2-backdrop-show,
        div[class*="swal"],
        div[id*="swal"] {
          display: none !important;
          opacity: 0 !important;
          visibility: hidden !important;
          pointer-events: none !important;
        }

        /* 3. P0 级二阶问题防护：强行解除弹窗组件向 html/body 施加的滚动锁死 */
        html, body {
          overflow: auto !important;
          position: static !important;
          height: auto !important;
        }

        /* 4. 隐藏真实章内分页器（软隐藏，不物理 remove） */
        #pagination-container, .pagination-container {
          display: none !important;
          visibility: hidden !important;
        }

        /* 5. P2 级底部定位父容器：保持 fixed 悬浮上下文，透传点击事件 */
        .tooltip-bar, .bottomMenu {
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          pointer-events: none !important;
        }

        /* 6. 恢复 P1 级与 P2 级内部真实交互按钮的点击响应 */
        .tooltip-bar a, 
        .bottomMenu a, 
        #chapter-list-button-desktop,
        .cm-topbar a {
          pointer-events: auto !important;
          cursor: pointer !important;
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

      text = text.replace('<head>', `<head>${apiShieldScript}`);
      text = text.replace('</head>', `${adShield}</head>`);

      // 3. 注入白名单 DOM 软掩蔽沙盒脚本
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
            '.tooltip-bar',
            '.bottomMenu',
            '#chapter-list-button-desktop',
            'script',
            'style',
            'link'
          ];

          function isAllowedNode(node) {
            if (node.nodeType !== Node.ELEMENT_NODE) return true;
            
            // 显式拦截 SweetAlert2 相关动态节点
            if (node.className && typeof node.className === 'string' && node.className.includes('swal')) {
              return false;
            }
            if (node.id && typeof node.id === 'string' && node.id.includes('swal')) {
              return false;
            }

            return ALLOWED_SELECTORS.some(sel => {
              try {
                return node.matches(sel) || node.querySelector(sel) !== null || node.closest(sel) !== null;
              } catch (e) {
                return false;
              }
            });
          }

          // 核心修正：使用 CSS 软掩蔽 (display: none) 替代物理删除 (remove())，保护 DOM 父子结构
          function maskNode(node) {
            if (node.nodeType === Node.ELEMENT_NODE && !['SCRIPT', 'STYLE', 'LINK'].includes(node.tagName)) {
              node.style.setProperty('display', 'none', 'important');
              node.setAttribute('data-sandboxed-hidden', 'true');
            }
          }

          function performSoftPruning() {
            const mescroll = document.querySelector('#mescroll');
            if (mescroll) {
              // 第一重：body 直属层级隔离，软隐藏非白名单节点
              Array.from(document.body.children).forEach(child => {
                if (child !== mescroll && !isAllowedNode(child)) {
                  maskNode(child);
                }
              });

              // 第二重：#mescroll 内部非白名单节点软隐藏
              const internalNodes = mescroll.querySelectorAll('*');
              internalNodes.forEach(node => {
                if (!isAllowedNode(node)) {
                  maskNode(node);
                }
              });
            }
          }

          // 页面加载完成后立即软剪枝
          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', performSoftPruning);
          } else {
            performSoftPruning();
          }

          // 挂载 MutationObserver，拦截 AJAX 或异步 JS 动态插入的弹窗 / 广告节点
          const observer = new MutationObserver(mutations => {
            const mescroll = document.querySelector('#mescroll');
            mutations.forEach(mutation => {
              mutation.addedNodes.forEach(node => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                  if (node.parentNode === document.body && node !== mescroll && !isAllowedNode(node)) {
                    maskNode(node);
                    return;
                  }
                  if (mescroll && mescroll.contains(node) && !isAllowedNode(node)) {
                    maskNode(node);
                  }
                }
              });
            });

            // 持续兜底：防止第三方脚本向 html/body 强行注入 overflow: hidden 导致页面不可滑动
            if (document.body.style.overflow === 'hidden') {
              document.body.style.setProperty('overflow', 'auto', 'important');
            }
            if (document.documentElement.style.overflow === 'hidden') {
              document.documentElement.style.setProperty('overflow', 'auto', 'important');
            }
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

    // 针对 JSON 或其他文本接口，补充域名重写与 CORS 响应
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
