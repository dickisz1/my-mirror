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
        /* 1. 继续保留你抓取的去广告规则，但使用最温和的隐藏方式 */
        a[href][target][rel][style], div.footer-float-icon, i.fas.fa-times, img.return-top,
        div:has(> a > input), div[data-group] > a > input {
          position: absolute !important;
          top: -9999px !important; /* 将广告移出屏幕，而不是隐藏它 */
          opacity: 0 !important;
        }
        
        /* 2. 修正大喇叭图标尺寸，防止它撑破页面 */
        img[src*="notice"], .notice-icon { width: 32px !important; height: auto !important; }
      </style>
      
      <script>
        (function() {
          // A. 屏蔽浏览器原生弹窗 (如果它是用 alert 写的)
          window.alert = function() { return true; };

          // B. 自动清理自定义弹窗 (针对 dickisz123.dpdns.org 的检测弹窗)
          const killPopup = () => {
            // 寻找包含“关闭阻挡广告插件”文字的 div 或 button
            const elements = document.querySelectorAll('div, button, section');
            elements.forEach(el => {
              if (el.innerText && (el.innerText.includes('关闭阻挡广告插件') || el.innerText.includes('官方推荐浏览器'))) {
                // 尝试点击“确定”按钮
                const btn = el.querySelector('button') || el;
                if (btn) btn.click();
                // 物理移除整个弹窗层
                el.remove();
              }
            });
            
            // 移除可能存在的遮罩背景
            document.querySelectorAll('.modal-backdrop, [class*="mask"]').forEach(m => m.remove());
          };

          // 每 500 毫秒检查一次，一旦弹出立刻秒杀
          setInterval(killPopup, 500);
        })();
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
