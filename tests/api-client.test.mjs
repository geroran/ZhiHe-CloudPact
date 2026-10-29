import assert from 'node:assert/strict';
import test from 'node:test';
import { createApiClient } from '../src/shared/api.js';

const PROXY_CONFIG = {
  transport: 'proxy',
  origin: 'https://agent.example',
  appId: 'app-id-123',
  apiKey: 'secret-key-456',
  timeoutMs: 1000
};

function jsonResponse(body, options = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: options.status || 200,
    headers: { 'content-type': options.contentType || 'application/json' }
  });
}

test('proxy 模式走同源路径且不携带凭据', async () => {
  let captured = null;
  const api = createApiClient({ transport: 'proxy', timeoutMs: 1000 }, async (url, init) => {
    captured = { url, init };
    return jsonResponse({ ok: true, data: { answer: '代理回答' } });
  });

  const result = await api.request('chat_query_v2', { body: { Query: '你好' } });

  assert.equal(captured.url, '/api/agent/chat_query_v2');
  assert.equal(captured.init.headers.Apikey, undefined);
  assert.equal(result.ok, true);
  assert.equal(result.data.answer, '代理回答');
});

test('proxy 模式按 HTTP 状态映射鉴权失败且不泄漏凭据', async () => {
  const api = createApiClient(PROXY_CONFIG, async () => jsonResponse('unauthorized', { status: 401 }));
  const result = await api.request('chat_query_v2', { body: {} });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'UNAUTHORIZED');
  const serialized = JSON.stringify(result.error);
  assert.equal(serialized.includes('secret-key-456'), false);
  assert.equal(serialized.includes('app-id-123'), false);
  assert.equal(serialized.includes('agent.example'), false);
});

test('网络失败返回 NETWORK 且可重试', async () => {
  const api = createApiClient(PROXY_CONFIG, async () => {
    throw new TypeError('fetch failed');
  });
  const result = await api.request('chat_query_v2', { body: {} });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'NETWORK');
  assert.equal(result.error.retryable, true);
});

test('超过超时时间返回 TIMEOUT', async () => {
  const api = createApiClient(PROXY_CONFIG, (_url, init) => {
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'));
      });
    });
  });
  const result = await api.request('chat_query_v2', { body: {}, timeoutMs: 20 });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'TIMEOUT');
  assert.equal(result.error.retryable, true);
});

test('外部取消返回 ABORTED', async () => {
  const controller = new AbortController();
  const api = createApiClient(PROXY_CONFIG, (_url, init) => {
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'));
      });
    });
  });

  const pending = api.request('chat_query_v2', { body: {}, signal: controller.signal });
  controller.abort();
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'ABORTED');
});

test('proxy 模式识别 SSE 并拒绝按 blocking JSON 解析', async () => {
  const sse = 'event:text\ndata: {"event":"message","answer":"x"}\n';
  const api = createApiClient(PROXY_CONFIG, async () =>
    jsonResponse(sse, { contentType: 'text/event-stream' })
  );
  const result = await api.request('chat_query_v2', { body: {} });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'PROTOCOL_MISMATCH');
});

test('proxy 模式透传代理错误信封', async () => {
  const api = createApiClient({ transport: 'proxy', timeoutMs: 1000 }, async () =>
    jsonResponse({
      ok: false,
      error: { code: 'UPSTREAM_ERROR', message: '上游失败', retryable: true }
    })
  );
  const result = await api.request('chat_query_v2', { body: {} });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'UPSTREAM_ERROR');
  assert.equal(result.error.retryable, true);
});

test('proxy 模式拒绝非信封内容', async () => {
  const api = createApiClient({ transport: 'proxy', timeoutMs: 1000 }, async () =>
    jsonResponse({ answer: 'missing envelope' })
  );
  const result = await api.request('chat_query_v2', { body: {} });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'BAD_RESPONSE');
});

// 即使旧调用方传入凭据，客户端也只能请求本项目代理。
test('旧直连配置不会将凭据带到网络请求', async () => {
  const api = createApiClient({ transport: 'direct', origin: 'https://secret.test', appId: 'private-id', apiKey: 'private-key' }, async (url, init) => {
    assert.equal(url, '/api/agent/chat_query_v2');
    assert.equal(JSON.stringify(init).includes('private-'), false);
    return jsonResponse({ ok: true, data: {} });
  });
  assert.equal((await api.request('chat_query_v2')).ok, true);
});

test('流式客户端使用同源路径且不携带配置中的凭据', async () => {
  const api = createApiClient(PROXY_CONFIG, async (url, init) => {
    assert.equal(url, '/api/agent/chat_query_v2');
    assert.equal(init.headers.Apikey, undefined);
    return new Response('data: {}\n\n', { headers: { 'content-type': 'text/event-stream' } });
  });
  const chunks = [];
  assert.equal((await api.stream('chat_query_v2', { onText: text => chunks.push(text) })).ok, true);
  assert.equal(chunks.join(''), 'data: {}\n\n');
});
