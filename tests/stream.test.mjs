import assert from 'node:assert/strict';
import test from 'node:test';
import { streamQuery } from '../src/modules/ai-assistant/agent-api.js';

function frame(event, payload) {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function fakeStreamApi(chunks, result = { ok: true, data: null }) {
  const calls = [];
  return {
    calls,
    stream: async (endpoint, options) => {
      calls.push({ endpoint, options });
      for (const chunk of chunks) options.onText(chunk);
      return result;
    }
  };
}

test('streamQuery 使用 chat_query_v2 streaming 并逐段回调', async () => {
  const chunks = [
    frame('message_start', { event: 'message_start', task_id: 't1' }),
    frame('think_message', { event: 'think_message', answer: '不应展示的推理' }),
    frame('tool_message', { event: 'tool_message', answer: '不应展示的工具' }),
    frame('message', { event: 'message', answer: '模拟' }),
    frame('message', { event: 'message', answer: '回答' }),
    frame('message_end', { event: 'message_end', answer: '模拟回答' })
  ];
  const api = fakeStreamApi([chunks.slice(0, 3).join('') + chunks[3] + chunks[4], chunks[5]]);
  const seen = [];

  const result = await streamQuery(api, {
    conversationId: 'conv-1',
    query: '你好',
    userId: 'u1',
    onEvent: ({ text }) => seen.push(text)
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.answer, '模拟回答');
  assert.deepEqual(seen, ['模拟', '模拟回答']);
  assert.deepEqual(api.calls[0].options.body, {
    Query: '你好',
    AppConversationID: 'conv-1',
    ResponseMode: 'streaming',
    UserID: 'u1'
  });
  assert.equal(api.calls[0].endpoint, 'chat_query_v2');
});

test('message_end 的累计回答覆盖增量片段', async () => {
  const api = fakeStreamApi([
    frame('message', { event: 'message', answer: '你' }) +
      frame('message_end', { event: 'message_end', answer: '你好世界' })
  ]);
  const result = await streamQuery(api, {
    conversationId: 'conv-1',
    query: 'q',
    userId: 'u1'
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.answer, '你好世界');
});

test('上游未提供 SSE 时返回 STREAM_UNSUPPORTED 供回退', async () => {
  const api = fakeStreamApi([], {
    ok: false,
    error: { code: 'STREAM_UNSUPPORTED', message: '上游未返回 SSE 流。', retryable: false }
  });
  const result = await streamQuery(api, {
    conversationId: 'conv-1',
    query: 'q',
    userId: 'u1'
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'STREAM_UNSUPPORTED');
});

test('message_failed 返回可重试错误', async () => {
  const api = fakeStreamApi([
    frame('message', { event: 'message', answer: '部分' }),
    frame('message_failed', { event: 'message_failed', message: '生成失败' })
  ]);
  const result = await streamQuery(api, {
    conversationId: 'conv-1',
    query: 'q',
    userId: 'u1'
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'MESSAGE_FAILED');
  assert.equal(result.error.message, '生成失败');
});

test('V1 嵌套 data 触发 PROTOCOL_MISMATCH', async () => {
  const api = fakeStreamApi([
    'event: text\ndata:data: {"event":"message","answer":"你"}\n\n'
  ]);
  const result = await streamQuery(api, {
    conversationId: 'conv-1',
    query: 'q',
    userId: 'u1'
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'PROTOCOL_MISMATCH');
});

test('没有回答内容时返回 EMPTY_ANSWER', async () => {
  const api = fakeStreamApi([
    frame('message_start', { event: 'message_start', task_id: 't1' })
  ]);
  const result = await streamQuery(api, {
    conversationId: 'conv-1',
    query: 'q',
    userId: 'u1'
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'EMPTY_ANSWER');
});

test('缺少会话或问题时返回参数错误且不发请求', async () => {
  const api = fakeStreamApi([]);
  const missingConversation = await streamQuery(api, { query: 'q', userId: 'u1' });
  const emptyQuery = await streamQuery(api, { conversationId: 'c', query: '  ', userId: 'u1' });

  assert.equal(missingConversation.error.code, 'INVALID_ARGUMENT');
  assert.equal(emptyQuery.error.code, 'INVALID_ARGUMENT');
  assert.equal(api.calls.length, 0);
});
