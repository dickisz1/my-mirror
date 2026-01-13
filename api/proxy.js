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

      const extractorCode = `
      <style>
        /* 第一步：让原网页所有内容消失 */
        html, body { background: #000 !important; visibility: hidden !important; height: 100% !important; overflow: auto !important; }

        /* 第二步：只给漫画主体和必要的交互按钮开绿灯 */
        #custom-reader, #custom-reader * { visibility: visible !important; }
        
        /* 第三步：设计 QQ 动漫风格的 UI */
        #custom-reader {
          position: absolute; top: 0; left: 0; width: 100%; min-height: 100%;
          background: #1a1a1a; display: flex; flex-direction: column; align-items: center;
          z-index: 999999;
        }
        #custom-header {
          width: 100%; height: 50px; background: #222; color: #eee;
          display: flex; align-items: center; justify-content: center;
          position: sticky; top: 0; font-weight: bold; border-bottom: 1px solid #333;
        }
        .clean-img { width: 100%; max-width: 800px; display: block; margin: 0 auto; }
      </style>

      <script>
        (function() {
          window.addEventListener('DOMContentLoaded', () => {
            // 创建我们的私人容器
            const reader = document.createElement('div');
            reader.id = 'custom-reader';
            reader.innerHTML = '<div id="custom-header">极净预览模式</div><div id="img-container"></div>';
            document.body.appendChild(reader);

            const container = reader.querySelector('#img-container');

            // 提取所有漫画图（排除掉那些带 ads 的干扰项）
            const imgs = document.querySelectorAll('img');
            imgs.forEach(img => {
              const src = img.getAttribute('data-original') || img.getAttribute('data-src') || img.src;
              if (src && !src.includes('ads') && !src.includes('logo') && img.width > 100) {
                const newImg = new Image();
                newImg.src = src;
                newImg.className = 'clean-img';
                container.appendChild(newImg);
              }
            });

            // 提取标题
            const title = document.querySelector('title')?.innerText || "正在阅读";
            document.getElementById('custom-header').innerText = title.split('-')[0];
          });
        })();
      </script>`;

      text = text.replace('</head>', `${extractorCode}</head>`);
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
