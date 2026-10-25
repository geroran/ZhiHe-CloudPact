import assert from 'node:assert/strict';
import test from 'node:test';
import { createApiClient } from '../src/shared/api.js';

const DIRECT_CONFIG = {
  transport: 'direct',
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

test('direct 模式使用真实上游地址并携带 Apikey', async () => {
  let captured = null;
  const api = createApiClient(DIRECT_CONFIG, async (url, init) => {
    captured = { url, init };
    return jsonResponse({ answer: '真实回答' });
  });

  const result = await api.request('chat_query_v2', { body: { Query: '你好' } });

  assert.equal(
    captured.url,
    'https://agent.example/api/proxy/api/v1/chat_query_v2?appid=app-id-123'
  );
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers.Apikey, 'secret-key-456');
  assert.deepEqual(JSON.parse(captured.init.body), { Query: '你好' });
  assert.equal(result.ok, true);
  assert.equal(result.data.answer, '真实回答');
});

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

test('direct 模式按 HTTP 状态映射鉴权失败且不泄漏凭据', async () => {
  const api = createApiClient(DIRECT_CONFIG, async () => jsonResponse('unauthorized', { status: 401 }));
  const result = await api.request('chat_query_v2', { body: {} });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'UNAUTHORIZED');
  const serialized = JSON.stringify(result.error);
  assert.equal(serialized.includes('secret-key-456'), false);
  assert.equal(serialized.includes('app-id-123'), false);
  assert.equal(serialized.includes('agent.example'), false);
});

test('网络失败返回 NETWORK 且可重试', async () => {
  const api = createApiClient(DIRECT_CONFIG, async () => {
    throw new TypeError('fetch failed');
  });
  const result = await api.request('chat_query_v2', { body: {} });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'NETWORK');
  assert.equal(result.error.retryable, true);
});

test('超过超时时间返回 TIMEOUT', async () => {
  const api = createApiClient(DIRECT_CONFIG, (_url, init) => {
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
  const api = createApiClient(DIRECT_CONFIG, (_url, init) => {
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

test('direct 模式识别 SSE 并拒绝按 blocking JSON 解析', async () => {
  const sse = 'event:text\ndata: {"event":"message","answer":"x"}\n';
  const api = createApiClient(DIRECT_CONFIG, async () =>
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
