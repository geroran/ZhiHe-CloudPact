import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createConversation,
  fetchAppConfig,
  fetchConversationMessages,
  sendQuery
} from '../src/modules/ai-assistant/agent-api.js';

function fakeApi(responses) {
  const calls = [];
  return {
    calls,
    request: async (path, options) => {
      calls.push({ path, options });
      const response = responses[path];
      if (!response) throw new Error(`unexpected path: ${path}`);
      return response;
    }
  };
}

test('fetchAppConfig 解析开场白与推荐问题', async () => {
  const api = fakeApi({
    get_app_config_preview: {
      ok: true,
      data: { Name: '配置名称', OpenMessage: '开场白', OpenQuery: ['示例问题'] }
    }
  });

  const result = await fetchAppConfig(api, 'user-1', { timeoutMs: 1000 });

  assert.equal(result.ok, true);
  assert.deepEqual(result.data, {
    name: '配置名称',
    openMessage: '开场白',
    openQueries: ['示例问题']
  });
  assert.deepEqual(api.calls[0].options.body, { UserID: 'user-1' });
  assert.equal(api.calls[0].options.timeoutMs, 1000);
});

test('createConversation 传递 UserID 并解析会话 ID', async () => {
  const api = fakeApi({
    create_conversation: {
      ok: true,
      data: { Conversation: { AppConversationID: 'conv-9', ConversationName: '会话' } }
    }
  });

  const result = await createConversation(api, 'user-1');

  assert.equal(result.ok, true);
  assert.equal(result.data.conversationId, 'conv-9');
  assert.deepEqual(api.calls[0].options.body, { UserID: 'user-1' });
});

test('sendQuery 使用 chat_query_v2 与 blocking 模式', async () => {
  const api = fakeApi({
    chat_query_v2: {
      ok: true,
      data: { event: 'message', answer: '回答', think_messages: ['隐藏'] }
    }
  });

  const result = await sendQuery(api, {
    conversationId: 'conv-1',
    query: '  问题  ',
    userId: 'user-1',
    timeoutMs: 120000
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.answer, '回答');
  assert.deepEqual(api.calls[0].options.body, {
    Query: '问题',
    AppConversationID: 'conv-1',
    ResponseMode: 'blocking',
    UserID: 'user-1'
  });
  assert.equal('think_messages' in result.data, false);
});

test('sendQuery 拒绝空问题且不发请求', async () => {
  const api = fakeApi({});
  const result = await sendQuery(api, {
    conversationId: 'conv-1',
    query: '   ',
    userId: 'user-1'
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'INVALID_ARGUMENT');
  assert.equal(api.calls.length, 0);
});

test('fetchConversationMessages 限制 Limit 在 1-100', async () => {
  const api = fakeApi({
    get_conversation_messages: { ok: true, data: { Messages: [] } }
  });

  await fetchConversationMessages(api, {
    conversationId: 'conv-1',
    userId: 'user-1',
    limit: 500
  });
  assert.equal(api.calls[0].options.body.Limit, 100);

  await fetchConversationMessages(api, {
    conversationId: 'conv-1',
    userId: 'user-1',
    limit: 0
  });
  assert.equal(api.calls[1].options.body.Limit, 100);
});
