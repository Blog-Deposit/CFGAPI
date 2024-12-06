export async function onRequest(context) {
  try {
    const TELEGRAPH_URL = 'https://generativelanguage.googleapis.com';
    const request = context.request;
    const url = new URL(request.url);

    // If the path is '/' redirect to '/v1beta'
    if (url.pathname === '/') {
      const redirectUrl = new URL('/v1beta', url.origin).toString();
      return Response.redirect(redirectUrl, 302); // Changed to 302 for temporary redirect
    }

    // Handling the rest of the logic as usual for non-root paths
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

    // Checking for SSE streaming content
    if (response.headers.get('content-type')?.includes('text/event-stream')) {
      const reader = response.body.getReader();
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();

      let lastContent = null;  // Store previous content
      let buffer = '';        // For handling incomplete data blocks

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
                    if (lastContent && isRepeatContent(content, lastContent)) {
                      continue;
                    }
                    lastContent = content;
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(parsedData)}\n\n`));
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

    // Non-streaming response handling
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

// Extract the actual content from the response
function extractContent(parsedData) {
  try {
    return parsedData.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } catch (e) {
    return JSON.stringify(parsedData);
  }
}

// Check if the current content is a repeat of the last one
function isRepeatContent(currentContent, lastContent) {
  if (!currentContent || !lastContent) return false;
  return lastContent.endsWith(currentContent);
}

// Handling OPTIONS request
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
