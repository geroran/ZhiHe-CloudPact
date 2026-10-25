import http from 'node:http';

const host = process.env.MOCK_HOST || '127.0.0.1';
const port = Number(process.env.MOCK_PORT || 0);
const expectedAppId = process.env.MOCK_APP_ID || 'test-appid';
const expectedApiKey = process.env.MOCK_API_KEY || 'test-key';

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendSse(res, frames) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive'
  });
  for (const frame of frames) res.write(frame);
  res.end();
}

function sseFrame(event, payload) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function chunkText(text, size) {
  const parts = [];
  for (let index = 0; index < text.length; index += size) {
    parts.push(text.slice(index, index + size));
  }
  return parts;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');

  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'apikey, content-type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': req.headers.origin || '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'apikey, content-type'
    });
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method not allowed' });
    return;
  }

  if (url.searchParams.get('appid') !== expectedAppId || req.headers.apikey !== expectedApiKey) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }

  let body = {};
  try {
    const raw = await readBody(req);
    body = raw ? JSON.parse(raw) : {};
  } catch {
    sendJson(res, 400, { error: 'invalid json' });
    return;
  }

  const path = url.pathname;

  if (path.endsWith('/get_app_config_preview')) {
    sendJson(res, 200, {
      Name: '测试智能体',
      OpenMessage: '你好，这是测试开场白。',
      OpenQuery: ['测试推荐问题一', '测试推荐问题二'],
      SuggestEnabled: false
    });
    return;
  }

  if (path.endsWith('/create_conversation')) {
    sendJson(res, 200, {
      Conversation: {
        AppConversationID: 'conv-test-1',
        ConversationName: '测试会话',
        EmptyConversation: true
      },
      BaseResp: null
    });
    return;
  }

  if (path.endsWith('/chat_query_v2')) {
    if (body.Query === 'FAIL') {
      sendJson(res, 500, { error: 'upstream failure' });
      return;
    }
    if (body.ResponseMode === 'streaming' && body.Query !== 'NOSSE') {
      const answer = `模拟回答：${body.Query}`;
      const frames = [
        sseFrame('message_start', { event: 'message_start', task_id: 'task-test' }),
        sseFrame('think_message', {
          event: 'think_message',
          task_id: 'task-test',
          answer: '不应展示的推理内容'
        }),
        sseFrame('tool_message', {
          event: 'tool_message',
          task_id: 'task-test',
          answer: '不应展示的工具内容'
        })
      ];
      for (const piece of chunkText(answer, 3)) {
        frames.push(
          sseFrame('message', {
            event: 'message',
            task_id: 'task-test',
            id: 'msg-test',
            conversation_id: 'inner-conv',
            answer: piece,
            created_at: 1753091868
          })
        );
      }
      frames.push(
        sseFrame('message_end', {
          event: 'message_end',
          task_id: 'task-test',
          id: 'msg-test',
          conversation_id: 'inner-conv',
          answer,
          created_at: 1753091868
        })
      );
      sendSse(res, frames);
      return;
    }
    if (body.ResponseMode !== 'blocking' && body.Query !== 'NOSSE') {
      sendJson(res, 400, { error: 'only blocking supported in mock' });
      return;
    }
    sendJson(res, 200, {
      event: 'message',
      task_id: 'task-test',
      id: 'msg-test',
      conversation_id: 'inner-conv',
      answer: `模拟回答：${body.Query}`,
      created_at: 1753091868,
      think_messages: ['不应展示的推理内容'],
      tool_messages: ['不应展示的工具内容'],
      total_tokens: 10
    });
    return;
  }

  if (path.endsWith('/get_conversation_messages')) {
    sendJson(res, 200, {
      Messages: [
        { Query: '旧问题', AnswerInfo: { Answer: '旧回答' } },
        { Query: '另一个旧问题', AnswerInfo: {} }
      ]
    });
    return;
  }

  sendJson(res, 404, { error: 'not found' });
});

server.listen(port, host, () => {
  console.log(`MOCK_READY ${server.address().port}`);
});
