




export const config = {
  runtime: 'edge',
};

const ASSET_HOST = "mwappimgs.cc";
const ASSET_PREFIX = "/__assets__";

// === 广告域名黑名单（代理层直接拦截） ===
const AD_DOMAINS = [
  'ezze0ct.com',
  'hokkid5.com',
  '4i5pi9b.com',
  'lglef6c.com',
  'osxakod.com',
  '8161gc.ezze0ct.com',
  '6863gc.ezze0ct.com',
  '8161g.hokkid5.com',
  '6863g.hokkid5.com',
  'gw.4i5pi9b.com',
  'gw.lglef6c.com',
  'gw.osxakod.com',
];

export default async function handler(req) {
  const targetHost = "manwari.cc";
  const url = new URL(req.url);
  const myHost = url.host;

  // === 代理层拦截广告域名请求 ===
  const requestHost = url.hostname;
  for (const adDomain of AD_DOMAINS) {
    if (requestHost.includes(adDomain)) {
      return new Response(
        JSON.stringify({ error: 'Ad request blocked', domain: adDomain }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  let realTargetHost = targetHost;
  let realPath = url.pathname;

  if (url.pathname.startsWith(ASSET_PREFIX)) {
    realTargetHost = ASSET_HOST;
    realPath = url.pathname.slice(ASSET_PREFIX.length) || "/";
  }

  const targetUrl = "https://" + realTargetHost + realPath + url.search;

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

      // === 注入：防弹窗 + 自动阅读 + 广告拦截 JS ===
      const apiAndAutoReadScript = `
      <script id="unlock-comic-script">
        (function blockMobilePopupsAndAutoRead() {
          var currentHost = window.location.host;

          // === 广告域名关键词 ===
          var AD_KEYWORDS = ['ezze0ct', 'hokkid5', '4i5pi9b', 'lglef6c', 'osxakod', '8161gc', '6863gc', 'gg.js'];

          // === 拦截 WebSocket 广告连接 ===
          var _origWebSocket = window.WebSocket;
          window.WebSocket = function(url) {
            if (typeof url === 'string') {
              for (var k = 0; k < AD_KEYWORDS.length; k++) {
                if (url.indexOf(AD_KEYWORDS[k]) !== -1) {
                  console.log('[广告拦截] WebSocket 被拦截:', url);
                  return { close: function(){}, onopen: null, onmessage: null, onclose: null, onerror: null };
                }
              }
            }
            return new _origWebSocket(url);
          };

          // === 拦截动态脚本注入 ===
          var _origCreateElement = document.createElement.bind(document);
          document.createElement = function(tag) {
            var el = _origCreateElement(tag);
            if (tag && tag.toLowerCase() === 'script') {
              var _origSrcSetter = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src').set;
              Object.defineProperty(el, 'src', {
                set: function(url) {
                  for (var k = 0; k < AD_KEYWORDS.length; k++) {
                    if (url && url.indexOf(AD_KEYWORDS[k]) !== -1) {
                      console.log('[广告拦截] 脚本注入被拦截:', url);
                      return;
                    }
                  }
                  _origSrcSetter.call(this, url);
                },
                configurable: true
              });
            }
            return el;
          };

          // === 拦截 location 跳转到广告 ===
          var _origLocationHrefSetter = Object.getOwnPropertyDescriptor(
            Object.getOwnPropertyDescriptor(window, 'location') || window, 'href'
          ) ? null : null;
          try {
            var locProto = Object.getPrototypeOf(window.location);
            var origHrefDesc = Object.getOwnPropertyDescriptor(locProto, 'href');
            if (origHrefDesc && origHrefDesc.set) {
              var origHrefSet = origHrefDesc.set;
              Object.defineProperty(locProto, 'href', {
                set: function(url) {
                  for (var k = 0; k < AD_KEYWORDS.length; k++) {
                    if (url && url.indexOf(AD_KEYWORDS[k]) !== -1) {
                      console.log('[广告拦截] location.href 跳转被拦截:', url);
                      return;
                    }
                  }
                  origHrefSet.call(this, url);
                },
                configurable: true
              });
            }
          } catch(e) {}

          // 防弹窗/强弹拦截
          var nativeOpen = window.open;
          window.open = function(url, target, features) {
            if (!url) return null;
            try {
              var targetUrl = new URL(url, window.location.href);
              if (targetUrl.host !== currentHost) {
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
                  return false;
                }
              }
              target = target.parentNode;
            }
          }, true);

          // 自动阅读与拓扑跳转引擎
          var CONFIG = {
            speedMultiplier: 2.5,
            bottomThreshold: 80
          };

          var isRunning = false;
          var animationFrameId = null;

          function verifyUrlTopology(currentUrlStr, targetHref) {
            try {
              var cur = new URL(currentUrlStr);
              var tgt = new URL(targetHref, currentUrlStr);

              if (tgt.host !== cur.host) return false;

              var curParts = cur.pathname.split('/').filter(Boolean);
              var tgtParts = tgt.pathname.split('/').filter(Boolean);

              if (curParts.length !== tgtParts.length) return false;

              for (var i = 0; i < curParts.length - 1; i++) {
                if (curParts[i] !== tgtParts[i]) return false;
              }

              var parseChapterNum = function(str) {
                var base = str.split('.')[0];
                var mainId = base.split('_')[0];
                return parseInt(mainId, 10);
              };

              var curNum = parseChapterNum(curParts[curParts.length - 1]);
              var tgtNum = parseChapterNum(tgtParts[tgtParts.length - 1]);

              if (!isNaN(curNum) && !isNaN(tgtNum)) {
                return tgtNum >= curNum;
              }

              return true;
            } catch (e) {
              return false;
            }
          }

          function smoothScrollStep() {
            if (!isRunning) return;

            window.scrollBy(0, 1.5 * CONFIG.speedMultiplier);

            var distanceToBottom = document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);

            if (distanceToBottom <= CONFIG.bottomThreshold) {
              isRunning = false;
              cancelAnimationFrame(animationFrameId);
              triggerNextChapter();
              return;
            }

            animationFrameId = requestAnimationFrame(smoothScrollStep);
          }

          function triggerNextChapter() {
            sessionStorage.setItem('AUTO_READ_ENABLED', '1');

            var currentUrl = window.location.href;
            var candidates = Array.from(document.querySelectorAll('#next_chapter, a.next-chapter, #next, .bottomMenu a, .tooltip-bar a'));
            
            var validNodes = candidates.filter(function(a) {
              var href = a.getAttribute('href');
              return href && verifyUrlTopology(currentUrl, href);
            });

            if (validNodes.length > 0) {
              var targetNode = validNodes[validNodes.length - 1];
              console.log('[无缝自动阅读] 拓扑校验成功，即刻精准跳转:', targetNode.href);
              targetNode.click();
            } else {
              console.warn('[无缝自动阅读] 未查找到可用的下一章节点，停止自动巡航');
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


          // === 解锁漫画图片铺满全屏（JS 强制覆盖内联样式） ===
          function unlockComicImages() {
            // 暴力选择所有可能的容器和图片
            var containers = document.querySelectorAll('#showimgcontent, .episode-detail, .epContent, .cImg, figure.cImg, #page-marker-1, .p15');
            containers.forEach(function(container) {
              var imgs = container.querySelectorAll('img');
              imgs.forEach(function(img) {
                // 移除内联 width/height 属性
                img.removeAttribute('width');
                img.removeAttribute('height');
                // 用 JS style.setProperty 覆盖内联样式（比 CSS !important 更强）
                // 腾讯漫画风格：PC端最大宽度1000px居中，移动端100%铺满
                var winWidth = window.innerWidth;
                var imgWidth = winWidth <= 599 ? '100%' : 'auto';
                var imgMaxWidth = winWidth <= 599 ? '100%' : '1000px';
                img.style.setProperty('width', imgWidth, 'important');
                img.style.setProperty('max-width', imgMaxWidth, 'important');
                img.style.setProperty('height', 'auto', 'important');
                img.style.setProperty('display', 'block', 'important');
              });
              // 同时解除父级 figure 和 div 的宽度限制
              var parents = container.querySelectorAll('figure, div');
              parents.forEach(function(parent) {
                parent.style.setProperty('width', '100%', 'important');
                var winWidth2 = window.innerWidth;
                parent.style.setProperty('max-width', winWidth2 <= 599 ? '100%' : '1000px', 'important');
                parent.style.setProperty('margin', '0', 'important');
                parent.style.setProperty('padding', '0', 'important');
              });
            });
            // 额外暴力处理：直接对所有 img 生效（兜底）
            var allImgs = document.querySelectorAll('img');
            allImgs.forEach(function(img) {
              // 只处理在 #showimgcontent 或 .episode-detail 或 .cImg 内的图片
              if (img.closest('#showimgcontent, .episode-detail, .cImg, .epContent')) {
                var winWidth3 = window.innerWidth;
                img.style.setProperty('width', winWidth3 <= 599 ? '100%' : 'auto', 'important');
                img.style.setProperty('max-width', winWidth3 <= 599 ? '100%' : '1000px', 'important');
                img.style.setProperty('height', 'auto', 'important');
              }
            });
            // === 同时隐藏顶部导航栏（JS 兜底） ===
            var topbars = document.querySelectorAll('.cm-topbar_container, .cm-topbar, header.cm-topbar, div[class*="topbar"]');
            topbars.forEach(function(tb) {
              tb.style.setProperty('display', 'none', 'important');
            });
            console.log('[漫画铺满] 已执行解锁，当前页面图片数:', allImgs ? allImgs.length : 0);
          }

          // DOM 加载完成后立即执行
          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', unlockComicImages);
          } else {
            unlockComicImages();
          }

          // 监听 DOM 变化，处理懒加载图片
          var imgObserver = new MutationObserver(function(mutations) {
            unlockComicImages();
          });
          imgObserver.observe(document.body, { childList: true, subtree: true });

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
              console.log('[无缝自动阅读] 跨章识别接续，恢复平滑滚动');
              setTimeout(toggleAutoRead, 1200);
            }
          });
        })();
      </script>`;

      // === 注入：广告屏蔽 CSS ===
      const adShield = `
      <style id="unlock-width-style">
        /* 基础广告元素 */
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

        /* SweetAlert 弹窗 */
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

        /* 页面布局修复 */
        html, body {
          overflow: auto !important;
          position: static !important;
          height: auto !important;
        }

        /* 分页容器（先隐藏再恢复） */
        #pagination-container, .pagination-container {
          display: none !important;
          visibility: hidden !important;
        }
        #pagination-container {
          display: block !important;
          visibility: visible !important;
        }

        /* === 隐藏顶部导航栏（遮挡漫画） === */
        .cm-topbar_container,
        .cm-topbar,
        .cm-topbar--fixed,
        .cm-topbar--absolute,
        header.cm-topbar,
        div[class*="topbar"],
        div[class*="TopBar"],
        div[class*="header"],
        .site-header,
        header[class*="top"],
        .navbar,
        .top-nav,
        .header-bar,
        .header-wrapper {
          display: none !important;
          opacity: 0 !important;
          visibility: hidden !important;
          position: fixed !important;
          top: -9999px !important;
          left: -9999px !important;
          width: 0 !important;
          height: 0 !important;
          overflow: hidden !important;
          z-index: -1 !important;
        }

        /* 工具栏/底部菜单背景透明但保留可点击 */
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

        /* === 广告屏蔽增强规则 === */
        /* 屏蔽 takeover-notification（全屏弹窗广告） */
        .takeover-notification,
        .takeover-box,
        .takeover-overlay,
        .takeover-ad {
          display: none !important;
          opacity: 0 !important;
          visibility: hidden !important;
          pointer-events: none !important;
        }

        /* 屏蔽隐形遮罩层（广告用的透明覆盖 div） */
        div[style*="position:fixed"][style*="z-index:100"],
        div[style*="position: fixed"][style*="z-index: 100"],
        div[style*="opacity:0.01"],
        div[style*="opacity: 0.01"],
        div[style*="z-index:99999"],
        div[style*="z-index: 99999"] {
          display: none !important;
          opacity: 0 !important;
          visibility: hidden !important;
          pointer-events: none !important;
        }

        /* 屏蔽 gg.js 相关的 style 元素 */
        #vjyfhmpi_style_id,
        #llwlqyfx_style_id {
          display: none !important;
        }

        /* 屏蔽 ball 相关广告元素 */
        .ball-ad,
        [id*="ball"],
        [class*="ball-ad"] {
          display: none !important;
        }

        /* === PC 端腾讯漫画风格适配（居中 + 舒适阅读宽度） === */
        /* 参考腾讯漫画：PC端最大宽度1000px居中显示，两侧留白 */
        @media (min-width: 600px) {
          /* 页面主体：限制最大宽度并居中 */
          html, body {
            max-width: 100% !important;
            width: 100% !important;
            margin: 0 auto !important;
            padding: 0 !important;
          }
          /* 漫画内容容器：最大宽度1000px居中 */
          #showimgcontent, .episode-detail, .epContent,
          #page-marker-1, .p15, .cImg, figure.cImg {
            max-width: 1000px !important;
            width: 100% !important;
            margin-left: auto !important;
            margin-right: auto !important;
            padding-left: 15px !important;
            padding-right: 15px !important;
          }
          /* 解除其他可能的父级宽度限制（但不超过1000px） */
          div[style*="width: 720"], div[style*="width:720"],
          div[style*="width: 768"], div[style*="width:768"],
          section, article, main, .container, .content, .main,
          .row, .col, .col-xs-12, .col-sm-12, .col-md-12, .col-lg-12,
          .wrapper, .page-content, .content-wrapper, .main-content {
            max-width: 100% !important;
            width: 100% !important;
            margin-left: auto !important;
            margin-right: auto !important;
            padding-left: 0 !important;
            padding-right: 0 !important;
          }
          /* 强制所有漫画图片：居中显示，不超过1000px */
          #showimgcontent img,
          .episode-detail img,
          .cImg img,
          img.calwh,
          img.lazy-image,
          img[width][height],
          .episode-detail figure img,
          #showimgcontent figure img,
          .episode-detail img[style*="width"],
          #showimgcontent img[style*="width"] {
            width: auto !important;
            max-width: 1000px !important;
            height: auto !important;
            display: block !important;
            margin: 0 auto !important;
          }
          /* 强制解除 figure/figcaption 的默认样式 */
          figure, figcaption {
            max-width: 100% !important;
            width: 100% !important;
            margin: 0 auto !important;
            padding: 0 !important;
          }
          /* 强制解除 body > div 等直接子级的宽度限制 */
          body > div, body > div > div, body > div > div > div {
            max-width: 100% !important;
            width: 100% !important;
          }
        }

        /* === 移动端内容适配（小屏幕保持铺满） === */
        @media (max-width: 599px) {
          html, body {
            width: 100% !important;
            max-width: 100% !important;
            overflow-x: hidden !important;
          }
          #showimgcontent, .episode-detail, .epContent, .cImg {
            width: 100% !important;
            max-width: 100% !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          #showimgcontent img,
          .episode-detail img,
          .cImg img {
            width: 100% !important;
            max-width: 100% !important;
            height: auto !important;
            display: block !important;
            margin: 0 auto !important;
          }
        }

        /* === 超宽屏适配（2K/4K 显示器，最大1200px居中） === */
        @media (min-width: 1920px) {
          #showimgcontent, .episode-detail, .epContent {
            max-width: 1200px !important;
            width: 100% !important;
            margin-left: auto !important;
            margin-right: auto !important;
          }
          #showimgcontent img,
          .episode-detail img,
          .cImg img {
            width: auto !important;
            max-width: 1200px !important;
            height: auto !important;
            display: block !important;
            margin: 0 auto !important;
          }
        }
        #cp_img img, #cp_img img.auto-loaded-img {
          image-orientation: none !important;
        }
      </style>`;

      text = text.replace(/<head(\s[^>]*)?>|<head>/i, '<head>' + apiAndAutoReadScript);
      text = text.replace(/<\/head>/i, adShield + '</head>');

      // === DOM 白名单沙箱（已将 pagination-container 加入白名单） ===
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
            'pagination-container',
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

      text = text.replace(/<\/body>/i, domWhitelistSandbox + '</body>');

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
