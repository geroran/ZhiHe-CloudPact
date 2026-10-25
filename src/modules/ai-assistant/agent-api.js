import {
  parseAppConfig,
  parseChatResponse,
  parseConversationMessages,
  parseCreateConversation
} from './parse.js';
import { createSseParser } from './sse.js';

const CREATE_TIMEOUT_MS = 30000;
const HISTORY_TIMEOUT_MS = 30000;
const HISTORY_LIMIT = 100;

function invalid(message) {
  return { ok: false, error: { code: 'INVALID_ARGUMENT', message, retryable: false } };
}

export async function fetchAppConfig(api, userId, { signal, timeoutMs = 15000 } = {}) {
  const response = await api.request('get_app_config_preview', {
    body: { UserID: userId },
    timeoutMs,
    signal
  });
  if (!response.ok) return response;
  return parseAppConfig(response.data);
}

export async function createConversation(api, userId, { timeoutMs = CREATE_TIMEOUT_MS, signal } = {}) {
  if (!userId) return invalid('缺少 UserID，无法创建会话。');
  const response = await api.request('create_conversation', {
    body: { UserID: userId },
    timeoutMs,
    signal
  });
  if (!response.ok) return response;
  return parseCreateConversation(response.data);
}

export async function sendQuery(
  api,
  { conversationId, query, userId, timeoutMs, signal }
) {
  if (!conversationId) return invalid('缺少会话 ID。');
  if (!userId) return invalid('缺少 UserID。');
  const text = typeof query === 'string' ? query.trim() : '';
  if (!text) return invalid('问题内容不能为空。');

  const response = await api.request('chat_query_v2', {
    body: {
      Query: text,
      AppConversationID: conversationId,
      ResponseMode: 'blocking',
      UserID: userId
    },
    timeoutMs,
    signal
  });
  if (!response.ok) return response;
  return parseChatResponse(response.data);
}

function mergeAnswer(current, chunk) {
  if (!chunk) return current;
  if (!current) return chunk;
  if (chunk === current) return current;
  if (chunk.startsWith(current)) return chunk;
  if (current.endsWith(chunk)) return current;
  return current + chunk;
}

/**
 * 流式发送问题：使用 chat_query_v2 + ResponseMode=streaming，
 * 逐段回调 onEvent({ text })；不支持 SSE 时返回 STREAM_UNSUPPORTED 供调用方回退。
 */
export async function streamQuery(
  api,
  { conversationId, query, userId, timeoutMs, signal, onEvent }
) {
  if (!conversationId) return invalid('缺少会话 ID。');
  if (!userId) return invalid('缺少 UserID。');
  const text = typeof query === 'string' ? query.trim() : '';
  if (!text) return invalid('问题内容不能为空。');
  if (!api || typeof api.stream !== 'function') {
    return {
      ok: false,
      error: { code: 'STREAM_UNSUPPORTED', message: '当前客户端不支持流式输出。', retryable: false }
    };
  }

  let answer = '';
  let failedMessage = '';
  let sawV1 = false;

  const parser = createSseParser((payload) => {
    if (payload.protocol === 'v1') {
      sawV1 = true;
      return;
    }
    const type = payload.event;
    if (type === 'message_failed') {
      failedMessage =
        (typeof payload.answer === 'string' && payload.answer) ||
        (typeof payload.message === 'string' && payload.message) ||
        '智能体消息生成失败。';
      return;
    }
    if (
      typeof payload.answer === 'string' &&
      (type === 'message' ||
        type === 'message_end' ||
        type === 'message_replace' ||
        type === 'message_output_end')
    ) {
      const merged = mergeAnswer(answer, payload.answer);
      if (merged !== answer) {
        answer = merged;
        if (typeof onEvent === 'function') onEvent({ text: answer });
      }
    }
  });

  const result = await api.stream('chat_query_v2', {
    body: {
      Query: text,
      AppConversationID: conversationId,
      ResponseMode: 'streaming',
      UserID: userId
    },
    timeoutMs,
    signal,
    onText: parser.push
  });

  parser.flush();
  if (!result.ok) return result;

  if (sawV1) {
    return {
      ok: false,
      error: {
        code: 'PROTOCOL_MISMATCH',
        message: '智能体返回了 V1 嵌套 data 格式，已停止解析。',
        retryable: false
      }
    };
  }
  if (failedMessage) {
    return { ok: false, error: { code: 'MESSAGE_FAILED', message: failedMessage, retryable: true } };
  }

  const final = answer.trim();
  if (!final) {
    return {
      ok: false,
      error: { code: 'EMPTY_ANSWER', message: '智能体返回了空回答。', retryable: true }
    };
  }
  return { ok: true, data: { answer: final } };
}

export async function fetchConversationMessages(
  api,
  { conversationId, userId, limit = HISTORY_LIMIT, signal }
) {
  if (!conversationId) return invalid('缺少会话 ID。');
  if (!userId) return invalid('缺少 UserID。');
  const safeLimit = Math.min(Math.max(Number(limit) || HISTORY_LIMIT, 1), 100);

  const response = await api.request('get_conversation_messages', {
    body: {
      Limit: safeLimit,
      AppConversationID: conversationId,
      UserID: userId
    },
    timeoutMs: HISTORY_TIMEOUT_MS,
    signal
  });
  if (!response.ok) return response;
  return parseConversationMessages(response.data);
}
