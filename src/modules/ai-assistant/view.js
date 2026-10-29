import { renderMarkdown } from './markdown.js';
import { stripSuggestedQuestions } from './parse.js';

const ICONS = {
  sparkle:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.6l1.7 4.7 4.7 1.7-4.7 1.7L12 15.4l-1.7-4.7L5.6 9l4.7-1.7L12 2.6Z"/><path d="M18.6 13.4l.9 2.4 2.4.9-2.4.9-.9 2.4-.9-2.4-2.4-.9 2.4-.9.9-2.4Z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="M5.5 11.5 12 5l6.5 6.5"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2.5"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6a1 1 0 0 1 1-1h9"/></svg>',
  retry:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 1 1 2.6 5.9"/><path d="M4 19v-6h6"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="M6 13l6 6 6-6"/></svg>'
};

const TEMPLATE = `
  <div class="ai-shell">
    <header class="ai-head">
      <div class="ai-head-main">
        <span class="ai-avatar" aria-hidden="true">${ICONS.sparkle}</span>
        <div class="ai-head-text">
          <p class="ai-title">校园 AI 助手</p>
          <p class="ai-subtitle">智启云聚 · 云南大学校园问答</p>
        </div>
      </div>
      <button type="button" class="ai-icon-btn" data-ref="newConversation" title="新对话" aria-label="新对话">
        ${ICONS.plus}
      </button>
    </header>
    <div class="ai-body">
      <div class="ai-scroll" data-ref="scroll">
        <div class="ai-thread">
          <div class="ai-welcome" data-ref="welcome" hidden>
            <span class="ai-welcome-mark" aria-hidden="true">${ICONS.sparkle}</span>
            <p class="ai-open-message" data-ref="openMessage"></p>
            <div class="ai-suggestions" data-ref="suggestions" hidden>
              <p class="ai-suggest-title">你可以这样问</p>
              <div class="ai-suggest-list" data-ref="suggestList"></div>
            </div>
          </div>
          <div class="ai-history-loading" data-ref="historyLoading" hidden>正在加载会话历史…</div>
          <div class="ai-messages" data-ref="messages" role="log" aria-live="polite" aria-relevant="additions"></div>
        </div>
      </div>
      <button type="button" class="ai-scroll-btn" data-ref="scrollBottom" aria-label="回到最新消息" hidden>
        ${ICONS.down}
      </button>
    </div>
    <div class="ai-footer">
      <div class="ai-footer-inner">
        <p class="ai-notice" data-ref="notice" hidden></p>
        <div class="ai-alert" data-ref="alert" role="alert" hidden>
          <p class="ai-alert-text" data-ref="alertText"></p>
          <button type="button" class="ai-alert-retry" data-ref="retry" hidden>重试</button>
        </div>
        <p class="ai-status" data-ref="status" role="status" aria-live="polite"></p>
        <form class="ai-composer" data-ref="composer">
          <label class="ai-sr-only" for="ai-question">输入你的问题</label>
          <textarea class="ai-input" id="ai-question" data-ref="input" rows="1" maxlength="2000"
            placeholder="给校园 AI 助手发送消息…"></textarea>
          <div class="ai-composer-actions">
            <button type="submit" class="ai-send" data-ref="send" aria-label="发送消息">${ICONS.send}</button>
            <button type="button" class="ai-stop" data-ref="stop" aria-label="停止生成" hidden>${ICONS.stop}</button>
          </div>
        </form>
        <p class="ai-hint">Enter 发送，Shift + Enter 换行</p>
      </div>
    </div>
  </div>
`;

function collectRefs(wrap) {
  const refs = {};
  wrap.querySelectorAll('[data-ref]').forEach((element) => {
    refs[element.dataset.ref] = element;
  });
  return refs;
}

function createActionButton(icon, label) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ai-action';
  button.innerHTML = icon;
  const text = document.createElement('span');
  text.className = 'ai-action-label';
  text.textContent = label;
  button.appendChild(text);
  return { button, text };
}

async function copyText(text) {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 剪贴板 API 被拒绝时退回旧方案。
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-9999px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

export function createView(root, handlers = {}) {
  root.innerHTML = '';
  const wrap = document.createElement('section');
  wrap.className = 'ai-assistant';
  wrap.innerHTML = TEMPLATE;
  root.appendChild(wrap);

  const refs = collectRefs(wrap);
  let busyTimer = null;
  let statusTimer = null;
  let busyLabel = '';
  let busyStartedAt = 0;
  let retryHandler = null;
  let locked = false;
  let isBusy = false;
  let stickToBottom = true;

  function setStatus(text) {
    if (statusTimer) {
      clearTimeout(statusTimer);
      statusTimer = null;
    }
    refs.status.textContent = text || '';
    // 非等待中的提示自动淡出，避免长期占用输入区上方空间。
    if (text && !isBusy) {
      statusTimer = setTimeout(() => {
        refs.status.textContent = '';
      }, 4000);
    }
  }

  function distanceToBottom() {
    return refs.scroll.scrollHeight - refs.scroll.scrollTop - refs.scroll.clientHeight;
  }

  function updateScrollButton() {
    // 欢迎页顶部不需要“回到最新”，它只在用户往上翻阅历史时出现。
    refs.scrollBottom.hidden = distanceToBottom() < 96 || refs.scroll.scrollTop <= 0;
  }

  function scrollToBottom() {
    refs.scroll.scrollTop = refs.scroll.scrollHeight;
    stickToBottom = true;
    updateScrollButton();
  }

  function resizeInput() {
    const input = refs.input;
    input.style.height = 'auto';
    const height = Math.min(Math.max(input.scrollHeight, 28), 150);
    input.style.height = `${height}px`;
  }

  function setComposerDisabled(disabled) {
    locked = Boolean(disabled);
    refs.input.disabled = locked;
    refs.send.disabled = locked;
    refs.newConversation.disabled = locked || isBusy;
    refs.stop.disabled = locked;
  }

  function setBusy(busy, label = '正在等待智能体回复…') {
    isBusy = Boolean(busy);
    refs.send.hidden = isBusy;
    refs.stop.hidden = !isBusy;
    refs.input.disabled = locked;
    refs.newConversation.disabled = locked || isBusy;

    if (busyTimer) {
      clearInterval(busyTimer);
      busyTimer = null;
    }

    if (isBusy) {
      busyLabel = label;
      busyStartedAt = Date.now();
      setStatus(label);
      busyTimer = setInterval(() => {
        const seconds = Math.floor((Date.now() - busyStartedAt) / 1000);
        refs.status.textContent = `${busyLabel}（已等待 ${seconds}s）`;
      }, 1000);
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
        button.addEventListener('click', () => {
          stickToBottom = true;
          handlers.onSuggestion(query);
        });
        refs.suggestList.appendChild(button);
      }
    }

    refs.suggestions.hidden = !hasQueries;
    refs.welcome.hidden = false;
  }

  function buildAssistantArticle(message, assistantName, isLastAssistant) {
    const article = document.createElement('article');
    article.className = 'ai-message ai-message-assistant';

    const avatar = document.createElement('span');
    avatar.className = 'ai-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.innerHTML = ICONS.sparkle;

    const content = document.createElement('div');
    content.className = 'ai-msg-content';

    const label = document.createElement('p');
    label.className = 'ai-message-label';
    label.textContent = assistantName || 'AI 助手';
    content.appendChild(label);

    const body = document.createElement('div');
    body.className = 'ai-message-body ai-markdown';

    // 上游在每条回答末尾附带“推荐问题”清单，展示层去掉这一段。
    const displayText = message.text ? stripSuggestedQuestions(message.text) : '';

    if (displayText) {
      body.innerHTML = renderMarkdown(displayText);
      if (message.streaming) body.classList.add('ai-message-streaming');
    } else if (message.streaming) {
      body.className = 'ai-message-body ai-message-pending';
      body.innerHTML =
        '<span class="ai-typing" aria-hidden="true"><i></i><i></i><i></i></span><span class="ai-sr-only">正在生成回复…</span>';
    } else if (message.text) {
      body.classList.add('ai-message-missing');
      body.textContent = '该条回复仅包含推荐问题，已省略。';
    } else {
      body.classList.add('ai-message-missing');
      body.textContent = '该条历史回复的文本字段未确认，暂无法显示。';
    }
    content.appendChild(body);

    if (!message.streaming && displayText) {
      const actions = document.createElement('div');
      actions.className = 'ai-msg-actions';

      const copy = createActionButton(ICONS.copy, '复制');
      copy.button.addEventListener('click', async () => {
        const ok = await copyText(displayText);
        copy.text.textContent = ok ? '已复制' : '复制失败';
        setTimeout(() => {
          copy.text.textContent = '复制';
        }, 1400);
      });
      actions.appendChild(copy.button);

      if (isLastAssistant) {
        const retry = createActionButton(ICONS.retry, '重新生成');
        retry.button.addEventListener('click', () => {
          if (typeof handlers.onRegenerate === 'function') handlers.onRegenerate();
        });
        actions.appendChild(retry.button);
      }

      content.appendChild(actions);
    }

    article.append(avatar, content);
    return article;
  }

  function buildUserArticle(message) {
    const article = document.createElement('article');
    article.className = 'ai-message ai-message-user';

    const body = document.createElement('div');
    body.className = 'ai-message-body';
    body.textContent = message.text || '';
    article.appendChild(body);
    return article;
  }

  function renderMessages(messages, assistantName) {
    const shouldStick = stickToBottom || distanceToBottom() < 64;
    let lastAssistantIndex = -1;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === 'assistant') {
        lastAssistantIndex = index;
        break;
      }
    }

    const fragment = document.createDocumentFragment();
    messages.forEach((message, index) => {
      fragment.appendChild(
        message.role === 'assistant'
          ? buildAssistantArticle(message, assistantName, index === lastAssistantIndex)
          : buildUserArticle(message)
      );
    });

    refs.messages.innerHTML = '';
    refs.messages.appendChild(fragment);

    if (shouldStick) {
      // 空会话回到欢迎区顶部，避免开场白被滚到中间。
      refs.scroll.scrollTop = messages.length ? refs.scroll.scrollHeight : 0;
    }
    updateScrollButton();
  }

  function setHistoryLoading(loading) {
    refs.historyLoading.hidden = !loading;
  }

  function submit() {
    stickToBottom = true;
    handlers.onSend(refs.input.value);
  }

  refs.composer.addEventListener('submit', (event) => {
    event.preventDefault();
    if (isBusy || locked) return;
    submit();
  });

  refs.input.addEventListener('input', resizeInput);

  refs.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (isBusy || locked) return;
      submit();
    }
  });

  refs.scroll.addEventListener('scroll', () => {
    stickToBottom = distanceToBottom() < 96;
    updateScrollButton();
  });

  refs.scrollBottom.addEventListener('click', scrollToBottom);
  refs.newConversation.addEventListener('click', () => handlers.onNewConversation());
  refs.stop.addEventListener('click', () => {
    if (typeof handlers.onStop === 'function') handlers.onStop();
  });
  refs.retry.addEventListener('click', () => {
    if (retryHandler) retryHandler();
  });

  resizeInput();

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
    scrollToBottom,
    getInput: () => refs.input.value,
    setInput: (value) => {
      refs.input.value = value || '';
      resizeInput();
    },
    clearInput: () => {
      refs.input.value = '';
      resizeInput();
    },
    focusInput: () => refs.input.focus(),
    destroy: () => {
      if (busyTimer) clearInterval(busyTimer);
      if (statusTimer) clearTimeout(statusTimer);
      busyTimer = null;
      statusTimer = null;
      wrap.remove();
    }
  };
}
