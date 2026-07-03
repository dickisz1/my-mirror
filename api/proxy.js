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

          // 立刻插入"加载中"提示,给用户视觉反馈
          var loadingTip = document.createElement('div');
          loadingTip.id = '__loading_tip__';
          loadingTip.style.textAlign = 'center';
          loadingTip.style.padding = '24px 0';
          loadingTip.style.color = '#999';
          loadingTip.innerHTML = '<div style="display:inline-block;width:20px;height:20px;border:2px solid #ddd;border-top-color:#666;border-radius:50%;animation:__spin__ 0.8s linear infinite;"></div><div style="margin-top:8px;">正在加载下一章...</div><style>@keyframes __spin__{to{transform:rotate(360deg);}}</style>';
          container.appendChild(loadingTip);

          // data-r-src 属性在 HTML 一返回时就已经写好了真实地址,
          // 不需要等待任何 JS 执行,直接 fetch 静态 HTML 解析即可,又快又稳
          fetch(href, { credentials: 'same-origin' })
            .then(function(res){ return res.text(); })
            .then(function(html){
              var parser = new DOMParser();
              var doc = parser.parseFromString(html, 'text/html');
              var nextContainer = doc.querySelector('#cp_img.view-main-1');
              var nextNextLink = doc.querySelector('a.view-fix-bottom-bar-item-menu-next');

              var tip = document.getElementById('__loading_tip__');
              if (tip) tip.remove();

              if (nextContainer) {
                var divider = document.createElement('div');
                divider.textContent = '— 已自动加载下一章 —';
                divider.style.textAlign = 'center';
                divider.style.color = '#999';
                divider.style.padding = '16px 0';
                container.appendChild(divider);

                // 图片数据是 AES-CBC 加密过的,密钥和IV都是 "my2ecret782ecret"(16字节)
                // 必须先解密成真实字节,才能当图片显示,不能直接拿地址当src用
                var __aesKeyPromise = null;
                function getAesKey() {
                  if (!__aesKeyPromise) {
                    var keyBytes = new TextEncoder().encode('my2ecret782ecret');
                    __aesKeyPromise = crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['decrypt']);
                  }
                  return __aesKeyPromise;
                }
                function decryptImageToBlobUrl(url) {
                  var ivBytes = new TextEncoder().encode('my2ecret782ecret');
                  return getAesKey()
                    .then(function(key){ return fetch(url).then(function(res){ return res.arrayBuffer().then(function(buf){ return [key, buf]; }); }); })
                    .then(function(pair){ return crypto.subtle.decrypt({ name: 'AES-CBC', iv: ivBytes }, pair[0], pair[1]); })
                    .then(function(decryptedBuf){
                      var blob = new Blob([decryptedBuf], { type: 'image/webp' });
                      return URL.createObjectURL(blob);
                    });
                }

                // 用 IntersectionObserver 实现"真正按需"懒加载:
                // 图片标签先占位插入,只有滚动到附近才去发请求+解密,避免一次性大量请求
                var __lazyDecryptObserver = new IntersectionObserver(function(entries, obs){
                  entries.forEach(function(entry){
                    if (!entry.isIntersecting) return;
                    var imgEl = entry.target;
                    var url = imgEl.getAttribute('data-real-url');
                    obs.unobserve(imgEl);
                    decryptImageToBlobUrl(url).then(function(blobUrl){
                      imgEl.src = blobUrl;
                    }).catch(function(err){
                      console.error('图片解密失败:', err);
                    });
                  });
                }, { rootMargin: '300px' });

                var imgs = nextContainer.querySelectorAll('img.content-img');
                imgs.forEach(function(img){
                  // 真正的完整图片地址在 data-r-src 里,不是 data-original
                  var real = img.getAttribute('data-r-src');
                  if (!real || real.indexOf('blob:') === 0) return;
                  var newImg = document.createElement('img');
                  newImg.setAttribute('data-real-url', real);
                  newImg.className = 'content-img auto-loaded-img';
                  newImg.style.display = 'block';
                  newImg.style.width = '100%';
                  newImg.style.minHeight = '400px'; // 图片没下载完时先占住高度,避免被压成细线
                  newImg.style.backgroundColor = '#f0f0f0'; // 占位时给个浅灰背景,过渡更自然
                  container.appendChild(newImg);
                  __lazyDecryptObserver.observe(newImg);
                });
              }

              if (nextNextLink) {
                nextLink.setAttribute('href', nextNextLink.getAttribute('href'));
              } else {
                nextLink.setAttribute('href', '');
              }
              history.pushState(null, '', href);

              container.parentNode.insertBefore(sentinel, container.nextSibling);
              loading = false;
            })
            .catch(function(err){
              console.error('自动加载下一章失败:', err);
              var tip2 = document.getElementById('__loading_tip__');
              if (tip2) tip2.remove();
              loading = false;
            });
        }

        var observer = new IntersectionObserver(function(entries){
          entries.forEach(function(entry){
            if (entry.isIntersecting) loadNextChapter();
          });
        }, { rootMargin: '1500px' });

        observer.observe(sentinel);
      });

      // ===== 自动滚屏功能 =====
      (function(){
        window.__scrollSpeed = 0.6;
        window.__scrollIndex = 1;
        window.__isScrolling = false;
        window.__scrollTimer = null;

        var speedLevels = [0.3, 0.6, 1, 1.8, 3];
        var speedNames  = ['极慢','慢速','中速','快速','极快'];

        var panel = document.createElement('div');
        panel.id = '__scroll_panel__';
        panel.style.cssText = 'position:fixed;bottom:80px;right:12px;z-index:999998;display:flex;flex-direction:column;align-items:center;gap:6px;background:rgba(0,0,0,0.55);border-radius:20px;padding:10px 8px;';
        document.body.appendChild(panel);

        function makeBtn(label){
          var b = document.createElement('button');
          b.textContent = label;
          b.style.cssText = 'width:36px;height:36px;border-radius:50%;border:none;background:rgba(255,255,255,0.18);color:#fff;font-size:16px;cursor:pointer;';
          return b;
        }

        var btnFaster = makeBtn('▲');
        var btnToggle = makeBtn('▶');
        var btnSlower = makeBtn('▼');
        var speedLabel = document.createElement('div');
        speedLabel.style.cssText = 'color:#fff;font-size:11px;text-align:center;';
        speedLabel.textContent = '慢速';

        panel.appendChild(btnFaster);
        panel.appendChild(btnToggle);
        panel.appendChild(btnSlower);
        panel.appendChild(speedLabel);

        function doScroll(){
          if (!window.__isScrolling) return;
          window.scrollBy(0, window.__scrollSpeed);
          window.__scrollTimer = requestAnimationFrame(doScroll);
        }

        function startScroll(){
          window.__isScrolling = true;
          btnToggle.textContent = '⏸';
          window.__scrollTimer = requestAnimationFrame(doScroll);
        }

        function stopScroll(){
          window.__isScrolling = false;
          btnToggle.textContent = '▶';
          if (window.__scrollTimer){ cancelAnimationFrame(window.__scrollTimer); window.__scrollTimer = null; }
        }

        btnToggle.addEventListener('click', function(e){
          e.stopPropagation();
          if (window.__isScrolling) stopScroll(); else startScroll();
        });

        btnFaster.addEventListener('click', function(e){
          e.stopPropagation();
          if (window.__scrollIndex < speedLevels.length - 1){
            window.__scrollIndex++;
            window.__scrollSpeed = speedLevels[window.__scrollIndex];
            speedLabel.textContent = speedNames[window.__scrollIndex];
          }
        });

        btnSlower.addEventListener('click', function(e){
          e.stopPropagation();
          if (window.__scrollIndex > 0){
            window.__scrollIndex--;
            window.__scrollSpeed = speedLevels[window.__scrollIndex];
            speedLabel.textContent = speedNames[window.__scrollIndex];
          }
        });

        // 点击漫画区域切换暂停/继续
        var comicArea = document.querySelector('#cp_img');
        if (comicArea){
          comicArea.addEventListener('click', function(){
            if (window.__isScrolling) stopScroll(); else startScroll();
          });
        }

        // 到底自动停
        window.addEventListener('scroll', function(){
          if (!window.__isScrolling) return;
          if ((window.innerHeight + window.scrollY) >= document.body.scrollHeight - 10) stopScroll();
        }, { passive: true });
      })();
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
