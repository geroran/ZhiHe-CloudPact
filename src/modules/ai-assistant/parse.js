function parseError(code, message) {
  return { ok: false, error: { code, message, retryable: false } };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function textOrNull(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * 解析 chat_query_v2 的 blocking JSON。
 * V2 非流式响应是扁平对象（answer 在顶层），不得按 V1 的嵌套 data 结构解析。
 * think_messages / tool_messages 不返回给视图层。
 */
export function parseChatResponse(json) {
  if (!isPlainObject(json)) {
    return parseError('PROTOCOL_MISMATCH', '智能体响应不是 JSON 对象，已停止解析。');
  }
  if (json.event === 'message_failed') {
    return parseError('MESSAGE_FAILED', '智能体回复失败，未返回可用回答。');
  }
  if (typeof json.answer !== 'string') {
    if ('data' in json) {
      return parseError(
        'PROTOCOL_MISMATCH',
        '智能体返回了 V1 嵌套结构，当前版本只解析 chat_query_v2 的扁平 JSON。'
      );
    }
    return parseError('PROTOCOL_MISMATCH', '智能体响应缺少 answer 字段，已停止解析。');
  }

  const answer = json.answer.trim();
  if (!answer) {
    return parseError('EMPTY_ANSWER', '智能体未返回可显示的回答。');
  }

  return {
    ok: true,
    data: {
      answer,
      event: typeof json.event === 'string' ? json.event : null,
      taskId: typeof json.task_id === 'string' ? json.task_id : null,
      messageId: typeof json.id === 'string' ? json.id : null,
      conversationId: typeof json.conversation_id === 'string' ? json.conversation_id : null,
      createdAt: Number.isFinite(json.created_at) ? json.created_at : null
    }
  };
}

/**
 * 解析 get_app_config_preview。只有真实返回的字段才进入视图。
 */
export function parseAppConfig(json) {
  if (!isPlainObject(json)) {
    return parseError('PROTOCOL_MISMATCH', '应用配置响应结构异常。');
  }

  const openQueries = Array.isArray(json.OpenQuery)
    ? json.OpenQuery.map((item) => textOrNull(item)).filter(Boolean)
    : [];

  return {
    ok: true,
    data: {
      name: textOrNull(json.Name) || '',
      openMessage: textOrNull(json.OpenMessage) || '',
      openQueries
    }
  };
}

/**
 * 上游回答末尾会附带“您还可以询问这些相关问题”及一组推荐问题。
 * 这些推荐问题已在首页展示，展示层去重时从正文中裁掉这一段。
 * 只裁切独立成行、出现在正文最后的部分，避免误删正文中的正常提及。
 */
const SUGGESTED_QUESTIONS_LINE =
  /^[ \t]*您(?:还|也)?可以(?:询问|问|了解)(?:这些|以下|一下|这个)?(?:的)?相关(?:的)?问题[^\n]*$/gm;

export function stripSuggestedQuestions(text) {
  const source = typeof text === 'string' ? text : '';
  if (!source) return '';

  let cutIndex = -1;
  for (const match of source.matchAll(SUGGESTED_QUESTIONS_LINE)) {
    cutIndex = match.index;
  }
  if (cutIndex < 0) return source.trim();

  return source.slice(0, cutIndex).trim();
}

/** 解析 create_conversation 的 Conversation.AppConversationID。 */
export function parseCreateConversation(json) {
  if (!isPlainObject(json) || !isPlainObject(json.Conversation)) {
    return parseError('PROTOCOL_MISMATCH', '创建会话响应结构异常。');
  }
  const conversationId = textOrNull(json.Conversation.AppConversationID);
  if (!conversationId) {
    return parseError('PROTOCOL_MISMATCH', '创建会话响应缺少 AppConversationID。');
  }
  return {
    ok: true,
    data: {
      conversationId,
      conversationName: textOrNull(json.Conversation.ConversationName) || ''
    }
  };
}

/**
 * 接口文档只给出 AnswerInfo 字段名，未展开其内部结构。
 * 这里只在能识别到文本字段时展示真实内容，否则标记缺失，不构造回答。
 */
function extractAnswerText(answerInfo) {
  if (typeof answerInfo === 'string') return textOrNull(answerInfo);
  if (!isPlainObject(answerInfo)) return null;
  for (const key of ['Answer', 'answer', 'Content', 'content']) {
    const value = textOrNull(answerInfo[key]);
    if (value) return value;
  }
  return null;
}

/** 解析 get_conversation_messages 的 Messages 列表。 */
export function parseConversationMessages(json) {
  if (!isPlainObject(json) || !Array.isArray(json.Messages)) {
    return parseError('PROTOCOL_MISMATCH', '会话历史响应缺少 Messages 列表。');
  }

  const messages = [];
  for (const item of json.Messages) {
    if (!isPlainObject(item)) continue;
    const query = textOrNull(item.Query);
    if (!query) continue;
    messages.push({ query, answer: extractAnswerText(item.AnswerInfo) });
  }

  return { ok: true, data: { messages } };
}
