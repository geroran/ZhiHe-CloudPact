import { createMarketApi } from './api.js';
import {
  displayField,
  formatDateTime,
  readPost,
  renderMarkdown,
  safeHttpUrl,
  truncateText,
} from './helpers.js';
import { createConversationStore, getWorkspaceId } from './store.js';

const MAX_HISTORY = 20;
const STYLE_ID = 'market-agent-styles';

/** 运行时注入样式，兼容宿主打包器与独立静态联调两种载入方式。 */
function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const link = document.createElement('link');
  link.id = STYLE_ID;
  link.rel = 'stylesheet';
  link.href = new URL('./styles.css', import.meta.url).href;
  document.head.appendChild(link);
}

const TEMPLATE = `
  <section class="market-agent" aria-label="校园集市 Agent">
    <header class="market-agent__top">
      <button type="button" class="market-agent__menu" data-action="toggle-sidebar" aria-label="打开会话列表">☰</button>
      <div class="market-agent__brand">
        <span class="market-agent__logo" aria-hidden="true">集</span>
        <div>
          <h1>校园集市 Agent</h1>
          <p>自然语言检索校园集市 · 只读</p>
        </div>
      </div>
      <div class="market-agent__market-status" data-role="market-status" aria-live="polite">
        <span class="market-agent__dot"></span>
        <span data-role="market-status-text">检测中…</span>
      </div>
    </header>

    <div class="market-agent__body">
      <aside class="market-agent__sidebar" data-role="sidebar" aria-label="会话列表">
        <button type="button" class="market-agent__new" data-action="new-conversation">＋ 新建对话</button>
        <div class="market-agent__conv-list" data-role="conv-list"></div>
        <p class="market-agent__sidebar-note">会话保存在本机浏览器，用于演示交互；接入宿主后改由宿主持久化。</p>
      </aside>

      <div class="market-agent__main">
        <header class="market-agent__chat-head">
          <div>
            <h2 data-role="chat-title">新对话</h2>
            <p data-role="chat-subtitle">只基于真实检索结果回答</p>
          </div>
          <button type="button" class="market-agent__ghost" data-action="delete-conversation">删除对话</button>
        </header>

        <div class="market-agent__chat" data-role="messages" aria-live="polite"></div>

        <div class="market-agent__banner" data-role="banner" role="status" hidden>
          <span data-role="banner-text"></span>
          <button type="button" class="market-agent__banner-close" data-action="dismiss-banner" aria-label="关闭提示">×</button>
        </div>

        <form class="market-agent__composer" data-role="composer">
          <textarea data-role="input" rows="2" maxlength="2000"
            placeholder="例如：帮我找一台 500 元以内、可以自提的显示器"></textarea>
          <div class="market-agent__composer-side">
            <p class="market-agent__hint" data-role="composer-hint">正在检测服务…</p>
            <button type="submit" data-role="send">发送</button>
          </div>
        </form>
      </div>

      <aside class="market-agent__results" data-role="results" aria-label="集市浏览结果">
        <div class="market-agent__results-head">
          <div class="market-agent__results-title">
            <h2>集市浏览</h2>
            <span data-role="results-source"></span>
          </div>
          <div class="market-agent__browse-actions">
            <button type="button" class="market-agent__ghost" data-browse="latest">最新</button>
            <button type="button" class="market-agent__ghost" data-browse="hot">热门</button>
          </div>
          <form class="market-agent__search" data-role="search-form">
            <input data-role="search-input" type="search" maxlength="60" placeholder="输入关键词搜索帖子" />
            <button type="submit" class="market-agent__ghost">搜索</button>
          </form>
        </div>
        <div class="market-agent__results-body" data-role="results-body"></div>
      </aside>
    </div>

    <div class="market-agent__overlay" data-role="overlay" data-action="toggle-sidebar" hidden></div>
  </section>
`;

export function mount(root, context = {}) {
  if (!root) throw new Error('market-agent 需要挂载根元素');
  ensureStyles();
  const api = createMarketApi(context.api);
  const workspaceId = getWorkspaceId(context);
  const store = createConversationStore(workspaceId);
  const notify = typeof context.notify === 'function' ? context.notify : () => {};

  const state = {
    config: null,
    configError: null,
    conversations: store.list(),
    activeId: store.activeId(),
    sending: false,
    browse: { status: 'idle', mode: null, keyword: '', result: null, error: null },
    sidebarOpen: false,
  };

  if (state.activeId && !store.get(state.activeId)) {
    state.activeId = state.conversations[0]?.id || null;
    store.setActive(state.activeId);
  }

  const chatAbort = new AbortController();
  const configAbort = new AbortController();
  const browseAbort = { current: null };
  let mounted = true;

  root.innerHTML = TEMPLATE;
  const el = root.querySelector('.market-agent');
  const nodes = {
    marketStatus: el.querySelector('[data-role="market-status"]'),
    marketStatusText: el.querySelector('[data-role="market-status-text"]'),
    sidebar: el.querySelector('[data-role="sidebar"]'),
    overlay: el.querySelector('[data-role="overlay"]'),
    convList: el.querySelector('[data-role="conv-list"]'),
    chatTitle: el.querySelector('[data-role="chat-title"]'),
    chatSubtitle: el.querySelector('[data-role="chat-subtitle"]'),
    messages: el.querySelector('[data-role="messages"]'),
    banner: el.querySelector('[data-role="banner"]'),
    bannerText: el.querySelector('[data-role="banner-text"]'),
    composer: el.querySelector('[data-role="composer"]'),
    input: el.querySelector('[data-role="input"]'),
    send: el.querySelector('[data-role="send"]'),
    hint: el.querySelector('[data-role="composer-hint"]'),
    results: el.querySelector('[data-role="results"]'),
    resultsBody: el.querySelector('[data-role="results-body"]'),
    resultsSource: el.querySelector('[data-role="results-source"]'),
    searchForm: el.querySelector('[data-role="search-form"]'),
    searchInput: el.querySelector('[data-role="search-input"]'),
  };

  function activeConversation() {
    return state.activeId ? state.conversations.find((item) => item.id === state.activeId) || null : null;
  }

  function persist(conversation) {
    store.save(conversation);
    state.conversations = store.list();
    state.activeId = conversation.id;
    store.setActive(conversation.id);
  }

  function createConversation() {
    const conversation = store.create('新对话');
    state.conversations = store.list();
    state.activeId = conversation.id;
    return conversation;
  }

  function showBanner(message) {
    nodes.bannerText.textContent = message;
    nodes.banner.hidden = false;
  }

  function hideBanner() {
    nodes.banner.hidden = true;
    nodes.bannerText.textContent = '';
  }

  function errorText(error) {
    const code = error?.code || 'UNKNOWN';
    const message = error?.message || '请求失败';
    return `请求失败（${code}）：${message}`;
  }

  async function loadConfig() {
    state.configError = null;
    renderStatus();
    let response;
    try {
      response = await api.getConfig(configAbort.signal);
    } catch (error) {
      if (error?.name === 'AbortError') return;
      response = { ok: false, error: { code: 'NETWORK_ERROR', message: '无法连接服务端' } };
    }
    if (!mounted) return;
    if (!response.ok) {
      state.config = null;
      state.configError = response.error || { code: 'BAD_RESPONSE', message: '服务返回格式异常' };
      showBanner(errorText(state.configError));
    } else {
      state.config = response.data;
      hideBanner();
    }
    renderAll();
  }

  function renderStatus() {
    const market = state.config?.market;
    nodes.marketStatus.classList.remove('is-ok', 'is-warn', 'is-unknown');
    if (state.configError) {
      nodes.marketStatus.classList.add('is-unknown');
      nodes.marketStatusText.textContent = '服务状态未知';
    } else if (!state.config) {
      nodes.marketStatus.classList.add('is-unknown');
      nodes.marketStatusText.textContent = '检测中…';
    } else if (market?.available && market.connected !== false && market.connected !== null) {
      nodes.marketStatus.classList.add('is-ok');
      nodes.marketStatusText.textContent = '真实数据源已连接';
    } else if (market?.available) {
      nodes.marketStatus.classList.add('is-warn');
      nodes.marketStatusText.textContent = market?.message || '已配置数据源，检索时验证连接';
    } else {
      nodes.marketStatus.classList.add('is-warn');
      nodes.marketStatusText.textContent = market?.message || '真实数据源未配置/不可用';
    }
  }

  function updateMarketConnection(connected, message) {
    if (!state.config) return;
    state.config = {
      ...state.config,
      market: {
        ...state.config.market,
        available: state.config.market?.available !== false,
        connected,
        message,
      },
    };
    renderStatus();
  }

  function renderConversations() {
    nodes.convList.replaceChildren();
    if (!state.conversations.length) {
      const empty = document.createElement('p');
      empty.className = 'market-agent__conv-empty';
      empty.textContent = '暂无历史对话';
      nodes.convList.append(empty);
      return;
    }
    for (const conversation of state.conversations) {
      const row = document.createElement('div');
      row.className = `market-agent__conv${conversation.id === state.activeId ? ' is-active' : ''}`;
      row.dataset.id = conversation.id;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'market-agent__conv-open';
      button.dataset.action = 'select-conversation';
      button.dataset.id = conversation.id;

      const title = document.createElement('span');
      title.className = 'market-agent__conv-title';
      title.textContent = conversation.title || '新对话';
      const meta = document.createElement('span');
      meta.className = 'market-agent__conv-meta';
      meta.textContent = `${conversation.messages?.length || 0} 条消息`;
      button.append(title, meta);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'market-agent__conv-delete';
      remove.dataset.action = 'delete-conversation';
      remove.dataset.id = conversation.id;
      remove.setAttribute('aria-label', `删除对话：${conversation.title || '新对话'}`);
      remove.textContent = '删除';

      row.append(button, remove);
      nodes.convList.append(row);
    }
  }

  function renderChatHeader() {
    const conversation = activeConversation();
    nodes.chatTitle.textContent = conversation?.title || '新对话';
    const market = state.config?.market;
    nodes.chatSubtitle.textContent = market?.available
      ? '先检索真实帖子，再由模型基于结果总结'
      : '真实数据源未配置/不可用，不会生成示例帖子';
  }

  function renderMessages() {
    nodes.messages.replaceChildren();
    const conversation = activeConversation();

    if (!conversation || !conversation.messages?.length) {
      const empty = document.createElement('div');
      empty.className = 'market-agent__empty';
      const title = document.createElement('h3');
      title.textContent = '描述你想找的校园集市内容';
      const text = document.createElement('p');
      text.textContent = '例如“帮我找一台 500 元以内、可以在呈贡自提的显示器”。没有真实数据源时，这里只显示错误状态，不会出现示例帖子。';
      empty.append(title, text);
      if (state.configError) {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'market-agent__ghost';
        retry.dataset.action = 'retry-config';
        retry.textContent = '重新检测服务';
        empty.append(retry);
      }
      nodes.messages.append(empty);
    } else {
      for (const message of conversation.messages) {
        nodes.messages.append(renderMessage(message, conversation));
      }
    }

    if (state.sending) {
      const typing = document.createElement('div');
      typing.className = 'market-agent__typing';
      typing.setAttribute('role', 'status');
      typing.textContent = '正在检索并等待模型回复…';
      nodes.messages.append(typing);
    }
    nodes.messages.scrollTop = nodes.messages.scrollHeight;
  }

  function renderMessage(message, conversation) {
    if (message.role === 'user') {
      const row = document.createElement('div');
      row.className = 'market-agent__row is-user';
      const bubble = document.createElement('div');
      bubble.className = 'market-agent__bubble';
      bubble.textContent = message.content;
      row.append(bubble);
      return row;
    }
    if (message.role === 'assistant') {
      const row = document.createElement('div');
      row.className = 'market-agent__row is-assistant';
      const bubble = document.createElement('div');
      bubble.className = 'market-agent__bubble market-agent__bubble--markdown';
      bubble.innerHTML = renderMarkdown(message.content);
      row.append(bubble);
      if (message.market?.posts?.length) {
        const link = document.createElement('button');
        link.type = 'button';
        link.className = 'market-agent__inline-link';
        link.dataset.action = 'show-chat-results';
        link.dataset.id = conversation.id;
        link.textContent = `查看本次检索结果（${message.market.posts.length} 条）`;
        row.append(link);
      }
      return row;
    }
    const row = document.createElement('div');
    row.className = 'market-agent__row is-error';
    const box = document.createElement('div');
    box.className = 'market-agent__error-box';
    const text = document.createElement('p');
    text.textContent = errorText(message);
    box.append(text);
    if (conversation.messages.some((item) => item.role === 'user')) {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'market-agent__ghost';
      retry.dataset.action = 'retry-message';
      retry.textContent = '重试';
      box.append(retry);
    }
    row.append(box);
    return row;
  }

  function renderComposer() {
    nodes.send.disabled = state.sending;
    nodes.input.disabled = state.sending;
    if (state.configError) {
      nodes.hint.textContent = '服务不可用，请先启动后端服务';
    } else if (!state.config) {
      nodes.hint.textContent = '正在检测服务…';
    } else if (!state.config.model?.configured) {
      nodes.hint.textContent = '模型服务未配置；发送后会显示明确错误，不返回硬编码回复';
    } else if (!state.config.market?.available) {
      nodes.hint.textContent = '真实数据源未配置/不可用；模型对话可用，但集市查询不会返回帖子';
    } else {
      nodes.hint.textContent = '只基于真实检索结果回答，缺失字段显示“未提供”';
    }
  }

  function renderResults() {
    nodes.resultsBody.replaceChildren();
    nodes.resultsSource.textContent = '';
    const browse = state.browse;

    if (browse.status === 'idle') {
      const empty = document.createElement('div');
      empty.className = 'market-agent__results-empty';
      empty.textContent = state.config?.market?.available
        ? '选择“最新”“热门”或输入关键词开始检索。'
        : '真实数据源未配置/不可用。这里不会显示示例帖子或固定搜索结果。';
      nodes.resultsBody.append(empty);
      return;
    }
    if (browse.status === 'loading') {
      const loading = document.createElement('div');
      loading.className = 'market-agent__results-empty';
      loading.textContent = '正在请求真实数据源…';
      nodes.resultsBody.append(loading);
      return;
    }
    if (browse.status === 'error') {
      const error = document.createElement('div');
      error.className = 'market-agent__error-box';
      const text = document.createElement('p');
      text.textContent = errorText(browse.error);
      error.append(text);
      if (browse.error?.retryable !== false) {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'market-agent__ghost';
        retry.dataset.action = 'retry-browse';
        retry.textContent = '重试';
        error.append(retry);
      }
      nodes.resultsBody.append(error);
      return;
    }

    const result = browse.result;
    const posts = Array.isArray(result?.posts) ? result.posts : [];
    nodes.resultsSource.textContent = result?.provider ? `来源：${result.provider}` : '';
    const meta = document.createElement('p');
    meta.className = 'market-agent__results-meta';
    meta.textContent = `检索时间：${formatDateTime(result?.retrieved_at)} · 共 ${posts.length} 条`;

    if (!posts.length) {
      const empty = document.createElement('div');
      empty.className = 'market-agent__results-empty';
      empty.textContent = '未检索到符合条件的帖子。';
      nodes.resultsBody.append(meta, empty);
      return;
    }
    nodes.resultsBody.append(meta);
    for (const raw of posts) {
      nodes.resultsBody.append(renderPostCard(raw, result?.provider));
    }
  }

  function renderPostCard(raw, provider) {
    const post = readPost(raw);
    const card = document.createElement('article');
    card.className = 'market-agent__post';

    const head = document.createElement('div');
    head.className = 'market-agent__post-head';
    const title = document.createElement('h3');
    title.textContent = displayField(post.title);
    const source = document.createElement('span');
    source.className = 'market-agent__post-source';
    source.textContent = `来源：${displayField(post.source || provider)}`;
    head.append(title, source);

    const meta = document.createElement('dl');
    meta.className = 'market-agent__post-meta';
    const rows = [
      ['价格', displayField(post.price)],
      ['位置', displayField(post.location)],
      ['联系方式', displayField(post.contact)],
      ['时间', formatDateTime(post.createdAt)],
      ['点赞', displayField(post.likeCount)],
      ['评论', displayField(post.commentCount)],
    ];
    if (post.category !== undefined) rows.splice(1, 0, ['分类', displayField(post.category)]);
    for (const [label, value] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      meta.append(dt, dd);
    }

    card.append(head, meta);

    if (post.content !== undefined && post.content !== null && String(post.content).trim()) {
      const content = document.createElement('p');
      content.className = 'market-agent__post-content';
      content.textContent = String(post.content).trim();
      card.append(content);
    }

    const footer = document.createElement('div');
    footer.className = 'market-agent__post-footer';
    const id = document.createElement('span');
    id.textContent = `帖子 ID：${displayField(post.id)}`;
    footer.append(id);

    const url = safeHttpUrl(post.url);
    if (url) {
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = '查看原帖';
      footer.append(link);
    } else {
      const linkText = document.createElement('span');
      linkText.textContent = `原帖链接：${displayField(post.url)}`;
      footer.append(linkText);
    }
    card.append(footer);
    return card;
  }

  function renderAll() {
    renderStatus();
    renderConversations();
    renderChatHeader();
    renderMessages();
    renderComposer();
    renderResults();
  }

  function ensureConversation() {
    return activeConversation() || createConversation();
  }

  function updateTitle(conversation, text) {
    if (conversation.messages.filter((item) => item.role === 'user').length === 1) {
      conversation.title = truncateText(text, 18);
    }
  }

  async function sendMessage(text) {
    if (!text || state.sending) return;
    const conversation = ensureConversation();
    conversation.messages.push({ role: 'user', content: text, createdAt: Date.now() });
    updateTitle(conversation, text);
    persist(conversation);
    state.sending = true;
    renderAll();
    await requestReply(conversation);
  }

  async function requestReply(conversation) {
    const valid = conversation.messages.filter((item) => item.role === 'user' || item.role === 'assistant');
    const last = valid[valid.length - 1];
    if (!last || last.role !== 'user') {
      state.sending = false;
      renderAll();
      return;
    }
    const history = valid
      .slice(0, -1)
      .slice(-MAX_HISTORY)
      .map((item) => ({ role: item.role, content: item.content }));

    try {
      const response = await api.chat(
        { message: last.content, history },
        chatAbort.signal,
      );
      if (response.ok) {
        const data = response.data || {};
        conversation.messages.push({
          role: 'assistant',
          content: String(data.reply || ''),
          model: data.model,
          market: data.market || null,
          createdAt: Date.now(),
        });
        if (data.market) {
          updateMarketConnection(true, '赞哦数据源已验证');
          state.browse = {
            status: 'success',
            mode: 'chat',
            keyword: state.browse.keyword,
            result: data.market,
            error: null,
          };
        }
        hideBanner();
      } else {
        conversation.messages.push({
          role: 'error',
          code: response.error?.code || 'UNKNOWN',
          message: response.error?.message || '请求失败',
          retryable: response.error?.retryable !== false,
          createdAt: Date.now(),
        });
        showBanner(errorText(response.error));
      }
    } catch (error) {
      if (error?.name === 'AbortError') return;
      conversation.messages.push({
        role: 'error',
        code: 'NETWORK_ERROR',
        message: '无法连接服务端',
        retryable: true,
        createdAt: Date.now(),
      });
      showBanner(errorText({ code: 'NETWORK_ERROR', message: '无法连接服务端' }));
    } finally {
      if (!mounted) return;
      state.sending = false;
      persist(conversation);
      renderAll();
    }
  }

  async function retryLast(conversation) {
    if (!conversation || state.sending) return;
    conversation.messages = conversation.messages.filter((item) => item.role !== 'error');
    const last = conversation.messages[conversation.messages.length - 1];
    if (!last || last.role !== 'user') return;
    state.sending = true;
    persist(conversation);
    renderAll();
    await requestReply(conversation);
  }

  async function browseMarket(mode, keyword = '') {
    if (state.browse.status === 'loading') return;
    if (mode === 'search' && !keyword) {
      state.browse = {
        status: 'error',
        mode,
        keyword,
        result: null,
        error: { code: 'INVALID_REQUEST', message: '请输入搜索关键词', retryable: false },
      };
      renderResults();
      return;
    }
    browseAbort.current?.abort();
    const controller = new AbortController();
    browseAbort.current = controller;
    state.browse = { status: 'loading', mode, keyword, result: null, error: null };
    renderResults();

    let response;
    try {
      response = mode === 'latest'
        ? await api.latest(20, controller.signal)
        : mode === 'hot'
          ? await api.hot(20, controller.signal)
          : await api.search(keyword, 1, controller.signal);
    } catch (error) {
      if (error?.name === 'AbortError') return;
      response = { ok: false, error: { code: 'NETWORK_ERROR', message: '无法连接服务端' } };
    }
    if (!mounted) return;

    if (response.ok) {
      updateMarketConnection(true, '赞哦数据源已验证');
      state.browse = {
        status: 'success',
        mode,
        keyword,
        result: response.data || {},
        error: null,
      };
      hideBanner();
    } else {
      updateMarketConnection(
        false,
        response.error?.message || '最近一次集市检索失败，请重试',
      );
      state.browse = {
        status: 'error',
        mode,
        keyword,
        result: null,
        error: response.error || { code: 'UNKNOWN', message: '请求失败' },
      };
      showBanner(errorText(response.error));
    }
    renderResults();
  }

  function toggleSidebar(force) {
    state.sidebarOpen = typeof force === 'boolean' ? force : !state.sidebarOpen;
    el.classList.toggle('is-sidebar-open', state.sidebarOpen && window.innerWidth <= 860);
    nodes.overlay.hidden = !(state.sidebarOpen && window.innerWidth <= 860);
  }

  function deleteConversation(id) {
    const conversation = state.conversations.find((item) => item.id === id);
    if (!conversation) return;
    const ok = window.confirm(`删除对话“${conversation.title || '新对话'}”？此操作不可恢复。`);
    if (!ok) return;
    store.remove(id);
    state.conversations = store.list();
    if (state.activeId === id) {
      state.activeId = state.conversations[0]?.id || null;
      store.setActive(state.activeId);
    }
    renderAll();
    notify('对话已删除');
  }

  function onClick(event) {
    const actionEl = event.target.closest('[data-action]');
    const browseEl = event.target.closest('[data-browse]');

    if (browseEl) {
      toggleSidebar(false);
      browseMarket(browseEl.dataset.browse);
      return;
    }
    if (!actionEl) return;
    const action = actionEl.dataset.action;

    if (action === 'toggle-sidebar') toggleSidebar();
    else if (action === 'new-conversation') {
      createConversation();
      toggleSidebar(false);
      hideBanner();
      renderAll();
      nodes.input.focus();
    } else if (action === 'select-conversation') {
      state.activeId = actionEl.dataset.id;
      store.setActive(state.activeId);
      toggleSidebar(false);
      hideBanner();
      renderAll();
    } else if (action === 'delete-conversation') {
      const id = actionEl.dataset.id || state.activeId;
      if (id) deleteConversation(id);
    } else if (action === 'dismiss-banner') hideBanner();
    else if (action === 'retry-config') loadConfig();
    else if (action === 'retry-message') retryLast(activeConversation());
    else if (action === 'retry-browse') {
      const mode = state.browse.mode || 'latest';
      browseMarket(mode, state.browse.keyword || '');
    } else if (action === 'show-chat-results') {
      const conversation = store.get(actionEl.dataset.id);
      const lastWithMarket = [...(conversation?.messages || [])]
        .reverse()
        .find((item) => item.role === 'assistant' && item.market);
      if (lastWithMarket) {
        state.browse = {
          status: 'success',
          mode: 'chat',
          keyword: '',
          result: lastWithMarket.market,
          error: null,
        };
        renderResults();
      }
    }
  }

  function onSubmit(event) {
    event.preventDefault();
    if (event.target === nodes.composer) {
      const text = nodes.input.value.trim();
      if (!text || state.sending) return;
      nodes.input.value = '';
      sendMessage(text);
      return;
    }
    if (event.target === nodes.searchForm) {
      browseMarket('search', nodes.searchInput.value.trim());
    }
  }

  function onKeydown(event) {
    if (event.key === 'Escape' && state.sidebarOpen) toggleSidebar(false);
    if (event.target !== nodes.input) return;
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (!nodes.send.disabled) nodes.composer.requestSubmit();
    }
  }

  function onResize() {
    if (!state.sidebarOpen) {
      el.classList.remove('is-sidebar-open');
      nodes.overlay.hidden = true;
    }
  }

  el.addEventListener('click', onClick);
  el.addEventListener('submit', onSubmit);
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('resize', onResize);

  renderAll();
  loadConfig();

  return function unmount() {
    configAbort.abort();
    chatAbort.abort();
    browseAbort.current?.abort();
    el.removeEventListener('click', onClick);
    el.removeEventListener('submit', onSubmit);
    window.removeEventListener('keydown', onKeydown);
    window.removeEventListener('resize', onResize);
    el.remove();
  };
}
