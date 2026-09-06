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

  const targetUrl = "https://" + realTargetHost + realPath + url.search;

  // 1. 克隆并修正请求头
  const newHeaders = new Headers();
  req.headers.forEach((value, key) => {
    if (key.toLowerCase() !== 'host') {
      newHeaders.set(key, value.replace(new RegExp(myHost, 'g'), realTargetHost));
    }
  });

  newHeaders.set('Host', realTargetHost);
  newHeaders.set('Referer', "https://" + realTargetHost + "/");

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const fetchOptions = {
      method: req.method,
      headers: newHeaders,
      redirect: 'manual',
      signal: controller.signal
    };

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method.toUpperCase())) {
      fetchOptions.body = await req.clone().arrayBuffer();
    }

    const response = await fetch(targetUrl, fetchOptions);
    clearTimeout(timeoutId);

    const resHeaders = new Headers();
    response.headers.forEach((v, k) => resHeaders.set(k, v));

    // 全局注入 CORS 支持
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

      // 1. 优先注入 JS API 劫持防御与无缝自动阅读巡航引擎脚本
      const apiAndAutoReadScript = `
      <script>
        (function blockMobilePopupsAndAutoRead() {
          var currentHost = window.location.host;

          // --- 第一部分：移动端弹窗与点击劫持防御 ---
          var nativeOpen = window.open;
          window.open = function(url, target, features) {
            if (!url) return null;
            try {
              var targetUrl = new URL(url, window.location.href);
              if (targetUrl.host !== currentHost) {
                console.warn('[Edge 防护] 已成功拦截跨域移动端强弹外链:', url);
                return null;
              }
            } catch (e) {
              return null;
            }
            return nativeOpen.apply(this, arguments);
          };

          document.addEventListener('click', function(e) {
            var target = e.target;
            while (target && target !== document.body) {
              if (target.tagName === 'A') {
                var href = target.getAttribute('href');
                if (href && (href.includes('9527') || href.includes('.vip') || (href.startsWith('http') && !href.includes(currentHost)))) {
                  e.preventDefault();
                  e.stopPropagation();
                  console.warn('[Edge 防护] 已成功拦截移动端触屏点击劫持外链:', href);
                  return false;
                }
              }
              target = target.parentNode;
            }
          }, true);

          // --- 第二部分：无缝自动阅读与平滑倍速巡航引擎 ---
          var CONFIG = {
            speedMultiplier: 2.5,
            bottomThreshold: 80
          };

          var isRunning = false;
          var animationFrameId = null;

          function smoothScrollStep() {
            if (!isRunning) return;

            window.scrollBy(0, 1.5 * CONFIG.speedMultiplier);

            var distanceToBottom = document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);

            if (distanceToBottom <= CONFIG.bottomThreshold) {
              console.log('[无缝自动阅读] 检测到触底，执行精准跨章跳转...');
              isRunning = false;
              cancelAnimationFrame(animationFrameId);
              triggerNextChapter();
              return;
            }

            animationFrameId = requestAnimationFrame(smoothScrollStep);
          }

          function triggerNextChapter() {
            sessionStorage.setItem('AUTO_READ_ENABLED', '1');

            var pathParts = window.location.pathname.split('/').filter(Boolean);
            var nextBtn = document.querySelector('#next_chapter, a.next-chapter, #next');

            if (!nextBtn) {
              var links = Array.from(document.querySelectorAll('.tooltip-bar a, .bottomMenu a, .cm-topbar a'));
              nextBtn = links.find(function(a) {
                var href = a.getAttribute('href') || '';
                var currentComicPath = '/comic/' + (pathParts[1] || '');
                return href.includes('/comic/') && href !== currentComicPath && !href.endsWith(currentComicPath + '/');
              });
            }

            if (nextBtn) {
              console.log('[无缝自动阅读] 已精准锁定下一章跳转:', nextBtn.href);
              nextBtn.click();
            } else {
              console.warn('[无缝自动阅读] 无法找到下一章链接（可能已是最后一章），已暂停。');
              sessionStorage.removeItem('AUTO_READ_ENABLED');
            }
          }

          function toggleAutoRead() {
            var pathParts = window.location.pathname.split('/').filter(Boolean);
            var isChapterPage = pathParts.length >= 3 && pathParts[0] === 'comic';

            if (!isChapterPage) {
              sessionStorage.removeItem('AUTO_READ_ENABLED');
              return;
            }

            isRunning = !isRunning;
            if (isRunning) {
              console.log('[无缝自动阅读] 已启动 | 倍速: ' + CONFIG.speedMultiplier + 'x');
              sessionStorage.setItem('AUTO_READ_ENABLED', '1');
              smoothScrollStep();
            } else {
              console.log('[无缝自动阅读] 已暂停');
              sessionStorage.removeItem('AUTO_READ_ENABLED');
              if (animationFrameId) cancelAnimationFrame(animationFrameId);
            }
          }

          document.addEventListener('DOMContentLoaded', function() {
            var autoScrollBtn = document.querySelector('#autoscroll');
            if (autoScrollBtn) {
              autoScrollBtn.onclick = function(e) {
                e.preventDefault();
                e.stopPropagation();
                toggleAutoRead();
              };
            }

            if (sessionStorage.getItem('AUTO_READ_ENABLED') === '1') {
              console.log('[无缝自动阅读] 识别到跨章接续标记，即将恢复平滑滚动...');
              setTimeout(toggleAutoRead, 1200);
            }
          });
        })();
      </script>`;

      // 2. 注入 CSS 防护
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

        html, body {
          overflow: auto !important;
          position: static !important;
          height: auto !important;
        }

        #pagination-container, .pagination-container {
          display: none !important;
          visibility: hidden !important;
        }

        .tooltip-bar, .bottomMenu {
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          pointer-events: none !important;
        }

        .tooltip-bar a, 
        .bottomMenu a, 
        #chapter-list-button-desktop,
        .cm-topbar a,
        .circle-box a,
        #autoscroll {
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

      text = text.replace('<head>', '<head>' + apiAndAutoReadScript);
      text = text.replace('</head>', adShield + '</head>');

      // 3. 注入白名单 DOM 软掩蔽沙盒脚本
      const domWhitelistSandbox = `
      <script>
        (function applyDOMWhitelistSandbox() {
          var ALLOWED_SELECTORS = [
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
            '.circle-box',
            '#autoscroll',
            '#chapter-list-button-desktop',
            'script',
            'style',
            'link'
          ];

          function isAllowedNode(node) {
            if (node.nodeType !== Node.ELEMENT_NODE) return true;

            if (node.className && typeof node.className === 'string' && node.className.includes('swal')) {
              return false;
            }
            if (node.id && typeof node.id === 'string' && node.id.includes('swal')) {
              return false;
            }

            return ALLOWED_SELECTORS.some(function(sel) {
              try {
                return node.matches(sel) || node.querySelector(sel) !== null || node.closest(sel) !== null;
              } catch (e) {
                return false;
              }
            });
          }

          function maskNode(node) {
            if (node.nodeType === Node.ELEMENT_NODE && !['SCRIPT', 'STYLE', 'LINK'].includes(node.tagName)) {
              node.style.setProperty('display', 'none', 'important');
              node.setAttribute('data-sandboxed-hidden', 'true');
            }
          }

          function performSoftPruning() {
            var mescroll = document.querySelector('#mescroll');
            if (mescroll) {
              Array.from(document.body.children).forEach(function(child) {
                if (child !== mescroll && !isAllowedNode(child)) {
                  maskNode(child);
                }
              });

              var internalNodes = mescroll.querySelectorAll('*');
              internalNodes.forEach(function(node) {
                if (!isAllowedNode(node)) {
                  maskNode(node);
                }
              });
            }
          }

          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', performSoftPruning);
          } else {
            performSoftPruning();
          }

          var observer = new MutationObserver(function(mutations) {
            var mescroll = document.querySelector('#mescroll');
            mutations.forEach(function(mutation) {
              mutation.addedNodes.forEach(function(node) {
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

      text = text.replace('</body>', domWhitelistSandbox + '</body>');

      // 域名重写与资源路径映射
      text = text.replace(new RegExp("https://" + ASSET_HOST, 'g'), ASSET_PREFIX);
      text = text.replace(new RegExp("https://" + targetHost, 'g'), "https://" + myHost);

      resHeaders.delete('content-length');
      resHeaders.set('content-type', 'text/html; charset=utf-8');

      return new Response(text, {
        status: response.status,
        headers: resHeaders
      });
    }

    if (contentType.includes('application/json') || contentType.includes('text/plain')) {
      let jsonText = await response.text();
      jsonText = jsonText.replace(new RegExp("https://" + targetHost, 'g'), "https://" + myHost);
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
    return new Response("Edge Proxy Error: " + err.message, { status: 502 });
  }
}
