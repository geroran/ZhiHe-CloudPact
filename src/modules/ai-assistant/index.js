import { createApiClient } from '../../shared/api.js';
import { readRuntimeConfig } from '../../shared/config.js';
import { resolveUserId } from '../../shared/user-id.js';
import {
  createConversation,
  fetchAppConfig,
  fetchConversationMessages,
  sendQuery,
  streamQuery
} from './agent-api.js';
import { createView } from './view.js';

const CONVERSATION_KEY = 'zyq.ai-assistant.conversation.v1';
const STYLE_ID = 'ai-assistant-styles';

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const link = document.createElement('link');
  link.id = STYLE_ID;
  link.rel = 'stylesheet';
  link.href = new URL('./styles.css', import.meta.url).href;
  document.head.appendChild(link);
}

function safeStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function readStoredValue(key) {
  const storage = safeStorage();
  if (!storage) return '';
  try {
    return storage.getItem(key) || '';
  } catch {
    return '';
  }
}

function writeStoredValue(key, value) {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    // 本地存储不可用时只影响刷新恢复，不影响当前会话。
  }
}

function explainError(error, config) {
  const code = error && error.code;
  if (code === 'NETWORK') {
    return '无法连接智能体服务，请稍后重试或联系演示管理员。';
  }
  if (code === 'AGENT_PROXY_UNAVAILABLE') return 'AI 服务尚未启动，请联系演示管理员。';
  if (code === 'CONFIG_ERROR') return '服务端尚未配置智能体，请联系演示管理员。';
  if (code === 'TIMEOUT') return '智能体响应超时，请稍后重试。';
  if (code === 'UNAUTHORIZED') return '智能体接口鉴权失败，请检查服务端配置。';
  if (code === 'ABORTED') return '请求已取消。';
  return (error && error.message) || '请求失败，请稍后重试。';
}

export function mount(root, context = {}) {
  ensureStyles();

  let { api, config } = context;
  const abortController = new AbortController();
  const signal = abortController.signal;

  let disposed = false;
  let busy = false;
  let historyLoading = false;
  let conversationId = '';
  let appConfig = null;
  let messages = [];
  let lastFailedQuery = null;
  let userId = '';

  const view = createView(root, {
    onSend: handleSend,
    onSuggestion: handleSuggestion,
    onNewConversation: handleNewConversation
  });

  if (!config) {
    const result = readRuntimeConfig();
    if (!result.ok) {
      view.showError(`运行配置未加载：${result.error.message}`);
      view.setComposerDisabled(true);
      return function unmount() {
        disposed = true;
        abortController.abort();
        view.destroy();
      };
    }
    config = result.data;
  }
  if (!api) api = createApiClient(config);

  const userResult = resolveUserId({ configured: config.userId, storage: safeStorage() });
  if (!userResult.ok) {
    view.showError(userResult.error.message);
    view.setComposerDisabled(true);
  } else {
    userId = userResult.data.userId;
  }

  conversationId = String(readStoredValue(CONVERSATION_KEY)).trim();

  const assistantName = () => (appConfig && appConfig.name) || 'AI 助手';

  let renderTimer = null;

  function cancelPendingRender() {
    if (renderTimer) {
      clearTimeout(renderTimer);
      renderTimer = null;
    }
  }

  /** 流式增量到达时节流渲染，避免每个片段都重排整段消息。 */
  function scheduleStreamingRender() {
    if (renderTimer || disposed) return;
    renderTimer = setTimeout(() => {
      renderTimer = null;
      if (disposed) return;
      view.renderMessages(messages, assistantName());
    }, 60);
  }

  function updateWelcome() {
    if (messages.length === 0 && !historyLoading) {
      if (appConfig) view.showWelcome(appConfig);
      else view.hideWelcome();
    } else {
      view.hideWelcome();
    }
  }

  async function loadAppConfig() {
    if (!userId || disposed) return;
    const result = await fetchAppConfig(api, userId, {
      signal,
      timeoutMs: config.configTimeoutMs
    });
    if (disposed || result.error && result.error.code === 'ABORTED') return;

    if (!result.ok) {
      const retryable = Boolean(result.error.retryable);
      view.showError(
        `开场白与推荐问题加载失败：${explainError(result.error, config)}`,
        retryable
          ? () => {
              view.clearError();
              void loadAppConfig();
            }
          : null
      );
      updateWelcome();
      return;
    }

    appConfig = result.data;
    updateWelcome();
  }

  async function loadHistory() {
    if (!conversationId || !userId || disposed) {
      updateWelcome();
      return;
    }

    historyLoading = true;
    view.setHistoryLoading(true);
    const result = await fetchConversationMessages(api, {
      conversationId,
      userId,
      signal
    });
    historyLoading = false;

    if (disposed || (result.error && result.error.code === 'ABORTED')) return;
    view.setHistoryLoading(false);

    if (!result.ok) {
      const retryable = Boolean(result.error.retryable);
      view.showError(
        `会话历史加载失败：${explainError(result.error, config)}`,
        retryable
          ? () => {
              view.clearError();
              void loadHistory();
            }
          : null
      );
      updateWelcome();
      return;
    }

    messages = [];
    for (const item of result.data.messages) {
      messages.push({ role: 'user', text: item.query });
      messages.push({ role: 'assistant', text: item.answer });
    }

    view.renderMessages(messages, assistantName());
    if (messages.length > 0) {
      view.hideWelcome();
      view.setStatus('已加载会话历史');
    } else {
      updateWelcome();
    }
  }

  function failRequest(query, error) {
    lastFailedQuery = query;
    view.setInput(query);
    view.showError(
      explainError(error, config),
      error.retryable
        ? () => {
            if (busy || disposed || !lastFailedQuery) return;
            const pending = lastFailedQuery;
            lastFailedQuery = null;
            view.clearError();
            void send(pending, { appendUser: false });
          }
        : null
    );
  }

  async function send(rawQuery, { appendUser }) {
    if (busy || disposed || !userId) return;

    const query = String(rawQuery || '').trim();
    if (!query) {
      view.focusInput();
      return;
    }

    lastFailedQuery = null;
    view.clearError();

    if (appendUser) {
      messages.push({ role: 'user', text: query });
    }
    view.setInput('');
    view.hideWelcome();
    view.renderMessages(messages, assistantName());

    busy = true;
    view.setBusy(true);

    try {
      if (!conversationId) {
        const created = await createConversation(api, userId, { signal });
        if (disposed) return;
        if (!created.ok) {
          failRequest(query, created.error);
          return;
        }
        conversationId = created.data.conversationId;
        writeStoredValue(CONVERSATION_KEY, conversationId);
      }

      const assistant = { role: 'assistant', text: '', streaming: true };
      messages.push(assistant);
      view.renderMessages(messages, assistantName());

      const streamed = await streamQuery(api, {
        conversationId,
        query,
        userId,
        timeoutMs: config.timeoutMs,
        signal,
        onEvent: ({ text }) => {
          if (disposed) return;
          assistant.text = text;
          scheduleStreamingRender();
        }
      });
      if (disposed) return;
      cancelPendingRender();

      if (streamed.ok) {
        assistant.text = streamed.data.answer;
        assistant.streaming = false;
        view.renderMessages(messages, assistantName());
        view.setStatus('已收到回复');
        return;
      }

      // 代理或上游未提供 SSE：退回 blocking 请求，保证功能可用。
      if (streamed.error && streamed.error.code === 'STREAM_UNSUPPORTED') {
        messages.pop();
        view.renderMessages(messages, assistantName());
        const result = await sendQuery(api, {
          conversationId,
          query,
          userId,
          timeoutMs: config.timeoutMs,
          signal
        });
        if (disposed) return;

        if (!result.ok) {
          failRequest(query, result.error);
          return;
        }

        messages.push({ role: 'assistant', text: result.data.answer });
        view.renderMessages(messages, assistantName());
        view.setStatus('已收到回复');
        return;
      }

      // 已收到真实片段时保留，不编造未到达的内容。
      const partial = assistant.text.trim();
      assistant.streaming = false;
      if (!partial) messages.pop();
      view.renderMessages(messages, assistantName());
      if (partial) {
        lastFailedQuery = null;
        view.showError(`回复未完整返回：${explainError(streamed.error, config)}`);
      } else {
        failRequest(query, streamed.error);
      }
    } finally {
      cancelPendingRender();
      busy = false;
      if (!disposed) view.setBusy(false);
    }
  }

  function handleSend(rawQuery) {
    void send(rawQuery, { appendUser: true });
  }

  function handleSuggestion(query) {
    if (busy || disposed) return;
    view.setInput(query);
    void send(query, { appendUser: true });
  }

  async function handleNewConversation() {
    if (busy || disposed || !userId) return;

    busy = true;
    view.clearError();
    view.setBusy(true, '正在创建新会话…');

    try {
      const created = await createConversation(api, userId, { signal });
      if (disposed) return;
      if (!created.ok) {
        view.showError(
          `新建会话失败：${explainError(created.error, config)}`,
          created.error.retryable
            ? () => {
                view.clearError();
                void handleNewConversation();
              }
            : null
        );
        return;
      }

      conversationId = created.data.conversationId;
      writeStoredValue(CONVERSATION_KEY, conversationId);
      messages = [];
      view.renderMessages(messages, assistantName());
      view.clearError();
      updateWelcome();
      view.setStatus('已创建新会话');
      view.focusInput();
    } finally {
      busy = false;
      if (!disposed) view.setBusy(false);
    }
  }

  void loadAppConfig();
  void loadHistory();

  return function unmount() {
    disposed = true;
    abortController.abort();
    view.destroy();
  };
}

export const mountAiAssistant = mount;
export default mount;
