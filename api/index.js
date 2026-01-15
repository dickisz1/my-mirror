export default async function (request) {
  const url = new URL(request.url);
  
  // --- 步骤 1：解析请求地址 ---
  console.log(`[Step 1] 正在处理请求: ${url.pathname}`);

  // 假设你的逻辑是把路径映射到 target 域名
  const targetUrl = "https://github.com" + url.pathname; 

  try {
    // --- 步骤 2：尝试请求源站 ---
    console.log(`[Step 2] 正在回源: ${targetUrl}`);
    
    const response = await fetch(targetUrl, {
      headers: request.headers,
      redirect: 'follow'
    });

    // --- 步骤 3：构建并返回结果 ---
    const newHeaders = new Headers(response.headers);
    
    // 添加自定义调试头，方便在浏览器查看
    newHeaders.set('X-Proxy-Step', 'Success-Fetch-Source');
    // 设置强力缓存
    newHeaders.set('Cache-Control', 'public, s-maxage=31536000'); 

    console.log(`[Step 3] 源站响应成功: ${response.status}`);

    return new Response(response.body, {
      status: response.status,
      headers: newHeaders
    });

  } catch (e) {
    // --- 错误捕捉 ---
    console.error(`[Error] 代理过程出错: ${e.message}`);
    return new Response(`Proxy Error: ${e.message}`, { 
      status: 502,
      headers: { 'X-Proxy-Step': 'Error-At-Fetch' } 
    });
  }
}
