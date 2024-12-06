export async function onRequest(context) {
  try {
    const TELEGRAPH_URL = 'https://generativelanguage.googleapis.com';
    const request = context.request;
    const url = new URL(request.url);
    
    // Check if the path is "/"
    if (url.pathname === '/') {
      url.pathname = '/v1beta';  // Redirect to /v1beta
      return Response.redirect(url.toString(), 302);
    }

    const newUrl = new URL(url.pathname + url.search, TELEGRAPH_URL);
    
    const providedApiKeys = url.searchParams.get('key');

    if (!providedApiKeys) {
      return new Response('API key is missing.', { status: 400 });
    }

    const apiKeyArray = providedApiKeys.split(';').map(key => key.trim()).filter(key => key !== '');

    if (apiKeyArray.length === 0) {
      return new Response('Valid API key is missing.', { status: 400 });
    }

    const selectedApiKey = apiKeyArray[Math.floor(Math.random() * apiKeyArray.length)];
    newUrl.searchParams.set('key', selectedApiKey);

    const modifiedRequest = new Request(newUrl.toString(), {
      headers: request.headers,
      method: request.method,
      body: request.body,
      redirect: 'follow'
    });

    const response = await fetch(modifiedRequest);

    if (!response.ok) {
      const errorBody = await response.text();
      return new Response(`API request failed: ${errorBody}`, { status: response.status });
    }

    // 检查是否是 SSE 流
    if (response.headers.get('content-type')?.includes('text/event-stream')) {
      const reader = response.body.getReader();
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();

      let lastContent = null;  // 存储上一次的内容
      let buffer = '';        // 用于处理跨块的数据
     
      const stream = new ReadableStream({
        async start(controller) {
          try {
            while (true) {
              const {done, value} = await reader.read();
              
              if (done) {
                // 处理缓冲区中剩余的数据
                if (buffer) {
                  if (buffer.startsWith('data: ')) {
                    const data = buffer.slice(6);
                    if (data !== '[DONE]') {
                      try {
                        const parsedData = JSON.parse(data);
                        const content = extractContent(parsedData);
                        if (!lastContent || !isRepeatContent(content, lastContent)) {
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify(parsedData)}\n\n`));
                        }
                      } catch (e) {
                        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
                      }
                    }
                  }
                }
                controller.close();
                break;
              }

              buffer += decoder.decode(value);
              const lines = buffer.split('\n');
              
              // 保留最后一行，因为它可能是不完整的
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const data = line.slice(6);
                  if (data === '[DONE]') {
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                    continue;
                  }

                  try {
                    const parsedData = JSON.parse(data);
                    const content = extractContent(parsedData);
                    
                    // 检查是否是重复内容
                    if (lastContent && isRepeatContent(content, lastContent)) {
                      continue; // 跳过重复内容
                    }

                    // 更新最后发送的内容
                    lastContent = content;
                    
                    // 发送数据
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(parsedData)}\n\n`));
                  } catch (e) {
                    // 如果解析失败，仍然发送原始数据
                    controller.enqueue(encoder.encode(`data: ${data}\n\n`));
                  }
                }
              }
            }
          } catch (error) {
            controller.error(error);
          }
        }
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    // 非流式响应直接返回
    const modifiedResponse = new Response(response.body, response);
    modifiedResponse.headers.set('Access-Control-Allow-Origin', '*');
    modifiedResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    modifiedResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type');
    
    return modifiedResponse;

  } catch (error) {
    console.error('Proxy error:', error);
    return new Response('An error occurred: ' + error.message, { 
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'text/plain'
      }
    });
  }
}

// 从响应数据中提取实际内容
function extractContent(parsedData) {
  try {
    return parsedData.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } catch (e) {
    return JSON.stringify(parsedData);
  }
}

// 检查是否是重复内容
function isRepeatContent(currentContent, lastContent) {
  if (!currentContent || !lastContent) return false;
  return lastContent.endsWith(currentContent);
}

// 处理 OPTIONS 请求
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400'
    }
  });
}
