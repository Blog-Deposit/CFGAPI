export async function onRequest(context) {
  try {
    const GEMINI_URL = 'https://generativelanguage.googleapis.com';
    const request = context.request;
    const url = new URL(request.url);

    // 从请求头中获取 OpenAI 格式的 Authorization: Bearer <key> 
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response('API key is missing or incorrect in Authorization header.', { status: 400 });
    }

    const providedApiKeys = authHeader.slice('Bearer '.length).trim();
    const apiKeyArray = providedApiKeys.split(';').map(key => key.trim()).filter(key => key !== '');
    if (apiKeyArray.length === 0) {
      return new Response('Valid API key is missing.', { status: 400 });
    }

    const selectedApiKey = apiKeyArray[Math.floor(Math.random() * apiKeyArray.length)];

    // 将请求转发到 Gemini API
    // 假设转发到 /v1/chat 之类的路径（根据实际Gemini路径修改）
    const newUrl = new URL(url.pathname + url.search, GEMINI_URL);
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

    // 检查 Gemini 是否返回 SSE 流
    if (response.headers.get('content-type')?.includes('text/event-stream')) {
      const reader = response.body.getReader();
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();

      let lastContent = null;
      let buffer = '';

      const stream = new ReadableStream({
        async start(controller) {
          try {
            while (true) {
              const {done, value} = await reader.read();
              if (done) {
                if (buffer) {
                  if (buffer.startsWith('data: ')) {
                    const data = buffer.slice(6);
                    if (data !== '[DONE]') {
                      try {
                        const parsedData = JSON.parse(data);
                        const content = extractContent(parsedData);
                        if (!lastContent || !isRepeatContent(content, lastContent)) {
                          const openAIData = transformToOpenAISSE(content);
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify(openAIData)}\n\n`));
                        }
                      } catch (e) {
                        // 无法解析则原样返回(不建议真实场景下如此)
                        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
                      }
                    }
                  }
                }
                // 最后发送DONE标记
                controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
                controller.close();
                break;
              }

              buffer += decoder.decode(value);
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const data = line.slice(6);
                  if (data === '[DONE]') {
                    // OpenAI的完成标记
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                    continue;
                  }

                  try {
                    const parsedData = JSON.parse(data);
                    const content = extractContent(parsedData);

                    if (lastContent && isRepeatContent(content, lastContent)) {
                      continue;
                    }

                    lastContent = content;

                    // 将Gemini输出转换为OpenAI SSE格式
                    const openAIData = transformToOpenAISSE(content);
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(openAIData)}\n\n`));
                  } catch (e) {
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

    // 非流式响应
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

// 从Gemini响应数据中提取内容
function extractContent(parsedData) {
  try {
    // Gemini的原结构示例：parsedData.candidates[0].content.parts[0].text
    return parsedData.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } catch (e) {
    return JSON.stringify(parsedData);
  }
}

// 转换为OpenAI SSE格式数据
function transformToOpenAISSE(content) {
  // 随机生成一个id或者使用固定值也行，此处简化处理
  const now = Math.floor(Date.now() / 1000);
  return {
    id: `cmpl-${now}-xyz`,  // 伪id，可根据需要自定义
    object: "chat.completion.chunk",
    created: now,
    model: "gpt-3.5-turbo", // 或根据实际模型名称设定
    choices: [
      {
        delta: {
          content: content
        },
        index: 0,
        finish_reason: null
      }
    ]
  };
}

function isRepeatContent(currentContent, lastContent) {
  if (!currentContent || !lastContent) return false;
  return lastContent.endsWith(currentContent);
}

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
