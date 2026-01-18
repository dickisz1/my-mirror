export const config = { runtime: 'edge' };

export default async function handler(req) {
  const targetHost = "manwa.me";
  const url = new URL(req.url);
  const myHost = url.host;

  // --- 1. 屏蔽/拦截名单 (这些请求直接返回空，不再去请求原站或等待) ---
  const blockList = [
    'popunder1000.js',
    'venor.php',
    'chicken.gif',
    '/rum', // 对应你截图里的 404/超时请求
    'jserror?type=',
    'code.js' // 很多统计脚本叫这个名字
  ];

  if (blockList.some(item => url.pathname.includes(item) || url.search.includes(item))) {
    return new Response('', { status: 204 }); // 拦截并返回“无内容”，瞬间完成
  }

  // --- 2. 处理图片代理 ---
  if (url.pathname.startsWith('/_img_proxy_/')) {
    const actualImageUrl = url.pathname.replace('/_img_proxy_/', 'https://');
    const imgRes = await fetch(actualImageUrl, {
      headers: { 'referer': `https://${targetHost}/` }
    });
    const imgHeaders = new Headers(imgRes.headers);
    imgHeaders.set('Cache-Control', 'public, s-maxage=86400');
    return new Response(imgRes.body, { headers: imgHeaders });
  }

  // --- 3. 抓取正文 ---
  const targetUrl = `https://${targetHost}${url.pathname}${url.search}`;
  const res = await fetch(targetUrl, {
    headers: { 
      'host': targetHost, 
      'referer': `https://${targetHost}/`,
      'cookie': '', // 保持匿名，增加缓存命中率
      'user-agent': req.headers.get('user-agent') // 转发爬虫标识
    }
  });

  const headers = new Headers(res.headers);
  headers.delete('Set-Cookie'); 
  headers.delete('Pragma');
  headers.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=600');

  // --- 4. HTML 内容清理与优化 ---
  if (headers.get('content-type')?.includes('text/html')) {
    let text = await res.text();
    
    // A. 暴力删除会导致卡顿的脚本标签
    // 匹配包含 blockList 中关键词的整个 <script> 标签并剔除
    blockList.forEach(item => {
      const re = new RegExp(`<script[^>]*?${item.replace('.', '\\.')}[^>]*?>[\\s\\S]*?<\\/script>`, 'gi');
      text = text.replace(re, '');
    });

    // B. 图片延迟加载替换为立即加载（通过代理）
    text = text.replace(/data-src="https:\/\//g, `src="https://${myHost}/_img_proxy_/`)
               .replace(/data-original="https:\/\//g, `src="https://${myHost}/_img_proxy_/`)
               .replace(/src="https:\/\/img\.manwa\.me/g, `src="https://${myHost}/_img_proxy_/img.manwa.me`);
    
    // C. 修复所有 A 标签链接，防止点击后跳回原站
    text = text.split(targetHost).join(myHost);

    // D. 注入 CSS 隐藏可能残留下来的广告位 (可选)
    text = text.replace('</head>', '<style>#popunder, .ad-class { display:none !important; }</style></head>');
    
    return new Response(text, { status: 200, headers });
  }

  return new Response(res.body, { status: res.status, headers });
}
