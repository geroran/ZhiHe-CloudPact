import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseAppConfig,
  parseChatResponse,
  parseConversationMessages,
  parseCreateConversation
} from '../src/modules/ai-assistant/parse.js';

test('parseChatResponse 接受 V2 扁平响应并丢弃思考/工具消息', () => {
  const result = parseChatResponse({
    event: 'message',
    task_id: 'task-1',
    id: 'msg-1',
    conversation_id: 'inner-1',
    answer: '  这是回答  ',
    created_at: 1753091868,
    think_messages: ['内部推理'],
    tool_messages: ['内部工具输出'],
    total_tokens: 10
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.answer, '这是回答');
  assert.equal(result.data.event, 'message');
  assert.equal(result.data.taskId, 'task-1');
  assert.equal('think_messages' in result.data, false);
  assert.equal('tool_messages' in result.data, false);
});

test('parseChatResponse 拒绝 V1 的嵌套 data 结构', () => {
  const result = parseChatResponse({ data: { answer: '不应该被解析' } });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'PROTOCOL_MISMATCH');
});

test('parseChatResponse 处理 message_failed', () => {
  const result = parseChatResponse({ event: 'message_failed', answer: '' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'MESSAGE_FAILED');
});

test('parseChatResponse 拒绝空回答和非对象响应', () => {
  assert.equal(parseChatResponse({ answer: '   ' }).error.code, 'EMPTY_ANSWER');
  assert.equal(parseChatResponse(null).error.code, 'PROTOCOL_MISMATCH');
  assert.equal(parseChatResponse('event: message').error.code, 'PROTOCOL_MISMATCH');
});

test('parseAppConfig 只保留真实存在的开场白与推荐问题', () => {
  const result = parseAppConfig({
    Name: '测试智能体',
    OpenMessage: ' 你好  ',
    OpenQuery: ['问题一', '', 42, '问题二'],
    SuggestEnabled: false
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.data, {
    name: '测试智能体',
    openMessage: '你好',
    openQueries: ['问题一', '问题二']
  });

  const empty = parseAppConfig({ Name: '只有名称' });
  assert.equal(empty.ok, true);
  assert.equal(empty.data.openMessage, '');
  assert.deepEqual(empty.data.openQueries, []);
});

test('parseCreateConversation 校验 AppConversationID', () => {
  const ok = parseCreateConversation({
    Conversation: { AppConversationID: 'conv-1', ConversationName: '新会话' }
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.data.conversationId, 'conv-1');

  assert.equal(parseCreateConversation({ Conversation: {} }).error.code, 'PROTOCOL_MISMATCH');
  assert.equal(parseCreateConversation({}).error.code, 'PROTOCOL_MISMATCH');
});

test('parseConversationMessages 映射历史消息并标记缺失回答', () => {
  const result = parseConversationMessages({
    Messages: [
      { Query: '旧问题', AnswerInfo: { Answer: '旧回答' } },
      { Query: '另一个问题', AnswerInfo: { unknown: 'x' } },
      { Query: '', AnswerInfo: { Answer: '会被跳过' } },
      'not-an-object'
    ]
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.data.messages, [
    { query: '旧问题', answer: '旧回答' },
    { query: '另一个问题', answer: null }
  ]);

  assert.equal(parseConversationMessages({}).error.code, 'PROTOCOL_MISMATCH');
});
