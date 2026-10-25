import { renderMarkdown } from './markdown.js';

const TEMPLATE = `
  <div class="ai-layout">
    <header class="ai-head">
      <div class="ai-title-group">
        <h1 class="ai-title">校园 AI 助手</h1>
        <p class="ai-subtitle">智启云聚 · 云南大学校园智能问答</p>
      </div>
      <div class="ai-head-actions">
        <button type="button" class="ai-btn ai-btn-ghost" data-ref="newConversation">新建会话</button>
      </div>
    </header>
    <p class="ai-notice" data-ref="notice" hidden></p>
    <div class="ai-alert" data-ref="alert" role="alert" hidden>
      <p class="ai-alert-text" data-ref="alertText"></p>
      <button type="button" class="ai-btn ai-btn-ghost" data-ref="retry" hidden>重试</button>
    </div>
    <div class="ai-panel">
      <div class="ai-status-row">
        <span class="ai-status" data-ref="status" role="status" aria-live="polite"></span>
      </div>
      <div class="ai-welcome" data-ref="welcome" hidden>
        <p class="ai-open-message" data-ref="openMessage"></p>
        <div class="ai-suggestions" data-ref="suggestions" hidden>
          <p class="ai-suggest-title">你可以这样问</p>
          <div class="ai-suggest-list" data-ref="suggestList"></div>
        </div>
      </div>
      <div class="ai-history-loading" data-ref="historyLoading" hidden>正在加载会话历史…</div>
      <div class="ai-messages" data-ref="messages" role="log" aria-live="polite" aria-relevant="additions"></div>
    </div>
    <form class="ai-composer" data-ref="composer">
      <label class="ai-sr-only" for="ai-question">输入你的问题</label>
      <textarea class="ai-input" id="ai-question" data-ref="input" rows="2" maxlength="2000"
        placeholder="例如：现在格物楼有空教室能上自习吗？"></textarea>
      <button type="submit" class="ai-btn ai-btn-primary" data-ref="send">发送</button>
    </form>
    <p class="ai-hint">Enter 发送，Shift + Enter 换行。复杂查询可能需要 30 秒到 1 分钟。</p>
  </div>
`;

function collectRefs(wrap) {
  const refs = {};
  wrap.querySelectorAll('[data-ref]').forEach((element) => {
    refs[element.dataset.ref] = element;
  });
  return refs;
}

export function createView(root, handlers) {
  root.innerHTML = '';
  const wrap = document.createElement('section');
  wrap.className = 'ai-assistant';
  wrap.innerHTML = TEMPLATE;
  root.appendChild(wrap);

  const refs = collectRefs(wrap);
  let busyTimer = null;
  let busyLabel = '';
  let busyStartedAt = 0;
  let retryHandler = null;

  function setStatus(text) {
    refs.status.textContent = text || '';
  }

  function setComposerDisabled(disabled) {
    refs.input.disabled = disabled;
    refs.send.disabled = disabled;
    refs.newConversation.disabled = disabled;
  }

  function setBusy(busy, label = '正在等待智能体回复…') {
    refs.input.disabled = busy;
    refs.send.disabled = busy;
    refs.newConversation.disabled = busy;

    if (busyTimer) {
      clearInterval(busyTimer);
      busyTimer = null;
    }

    if (busy) {
      busyLabel = label;
      busyStartedAt = Date.now();
      refs.send.textContent = '发送中…';
      setStatus(label);
      busyTimer = setInterval(() => {
        const seconds = Math.floor((Date.now() - busyStartedAt) / 1000);
        setStatus(`${busyLabel}（已等待 ${seconds}s）`);
      }, 1000);
    } else {
      refs.send.textContent = '发送';
    }
  }

  function clearError() {
    refs.alert.hidden = true;
    refs.alertText.textContent = '';
    retryHandler = null;
    refs.retry.hidden = true;
  }

  function showError(message, onRetry = null) {
    refs.alertText.textContent = message;
    refs.alert.hidden = false;
    retryHandler = onRetry;
    refs.retry.hidden = !onRetry;
  }

  function setNotice(message, tone = 'info') {
    if (!message) {
      refs.notice.hidden = true;
      refs.notice.textContent = '';
      refs.notice.className = 'ai-notice';
      return;
    }
    refs.notice.textContent = message;
    refs.notice.className = `ai-notice ai-notice-${tone}`;
    refs.notice.hidden = false;
  }

  function hideWelcome() {
    refs.welcome.hidden = true;
    refs.suggestions.hidden = true;
    refs.suggestList.innerHTML = '';
    refs.openMessage.textContent = '';
  }

  function showWelcome({ openMessage = '', openQueries = [] } = {}) {
    const hasMessage = Boolean(openMessage);
    const hasQueries = Array.isArray(openQueries) && openQueries.length > 0;
    if (!hasMessage && !hasQueries) {
      hideWelcome();
      return;
    }

    refs.openMessage.textContent = openMessage;
    refs.openMessage.hidden = !hasMessage;
    refs.suggestList.innerHTML = '';

    if (hasQueries) {
      for (const query of openQueries) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ai-suggestion';
        button.textContent = query;
        button.addEventListener('click', () => handlers.onSuggestion(query));
        refs.suggestList.appendChild(button);
      }
    }

    refs.suggestions.hidden = !hasQueries;
    refs.welcome.hidden = false;
  }

  function renderMessages(messages, assistantName) {
    refs.messages.innerHTML = '';
    for (const message of messages) {
      const article = document.createElement('article');
      article.className = `ai-message ai-message-${message.role}`;

      const label = document.createElement('p');
      label.className = 'ai-message-label';
      label.textContent =
        message.role === 'user' ? '你' : assistantName || 'AI 助手';

      if (message.role === 'assistant') {
        const body = document.createElement('div');
        body.className = 'ai-message-body ai-markdown';
        if (message.streaming) body.classList.add('ai-message-streaming');
        if (!message.text) {
          body.classList.add('ai-message-missing');
          body.textContent = message.streaming
            ? '正在生成回复…'
            : '该条历史回复的文本字段未确认，暂无法显示。';
        } else {
          body.innerHTML = renderMarkdown(message.text);
        }
        article.append(label, body);
      } else {
        const body = document.createElement('p');
        body.className = 'ai-message-body';
        body.textContent = message.text || '';
        article.append(label, body);
      }

      refs.messages.appendChild(article);
    }
    refs.messages.scrollTop = refs.messages.scrollHeight;
  }

  function setHistoryLoading(loading) {
    refs.historyLoading.hidden = !loading;
  }

  refs.composer.addEventListener('submit', (event) => {
    event.preventDefault();
    handlers.onSend(refs.input.value);
  });

  refs.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      handlers.onSend(refs.input.value);
    }
  });

  refs.newConversation.addEventListener('click', () => handlers.onNewConversation());
  refs.retry.addEventListener('click', () => {
    if (retryHandler) retryHandler();
  });

  return {
    setStatus,
    setComposerDisabled,
    setBusy,
    setNotice,
    clearError,
    showError,
    showWelcome,
    hideWelcome,
    renderMessages,
    setHistoryLoading,
    getInput: () => refs.input.value,
    setInput: (value) => {
      refs.input.value = value || '';
    },
    clearInput: () => {
      refs.input.value = '';
    },
    focusInput: () => refs.input.focus(),
    destroy: () => {
      if (busyTimer) clearInterval(busyTimer);
      busyTimer = null;
      wrap.remove();
    }
  };
}
