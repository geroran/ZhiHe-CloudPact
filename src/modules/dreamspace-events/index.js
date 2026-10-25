/**
 * 到梦空间活动查询模块（只读）。
 *
 * 依赖已部署的 dream-monitor 同源网页 API；本模块只调用：
 *   /api/me、/api/login、/api/logout、/api/state、/api/refresh、/api/activity
 * 不调用 /api/signup、/api/cancel，也不接触上游 token、密码、签名。
 */

import { createDreamApi, DreamApiError } from './api.js';
import { ensureStyle } from './styles.js';
import {
  el,
  stateLabel,
  stateTone,
  quotaText,
  numberText,
  formatTime,
  formatSyncTime,
  boolText,
  hasValue,
  DETAIL_ROWS,
} from './ui.js';
import { progressLabel, classifyRefreshResult, filterItems } from './logic.js';

export const manifest = Object.freeze({
  id: 'dreamspace-events',
  title: '到梦空间活动',
  path: '/dreamspace-events',
  description: '只读查询 dream-monitor 已同步的到梦空间活动列表与详情',
});

const POLL_INTERVAL_MS = 1500;
const REFRESH_TIMEOUT_MS = 120000;
const DATE_DETAIL_KEYS = new Set(['joindate', 'startdate', 'startdateDate', 'enddate']);
const LOGIN_FORM_COPY = '密码只提交给同源的 dream-monitor 后端；本页不保存密码、上游 token 或签名，仅使用 HttpOnly 会话 Cookie。';

const emptyDetail = () => ({ aid: null, loading: false, data: null, error: null });

function isAbort(error) {
  return error?.name === 'AbortError';
}

function rangeText(label, start, end) {
  const left = hasValue(start) ? formatTime(start) : null;
  const right = hasValue(end) ? formatTime(end) : null;
  if (left && right) return `${label} ${left} ~ ${right}`;
  if (left) return `${label} ${left}`;
  if (right) return `${label} 截止 ${right}`;
  return null;
}

export function mount(root, context = {}) {
  if (!root) throw new Error('dreamspace-events: 缺少挂载节点');

  // 只用 context.notify（主站的统一 API 客户端不是同源通用客户端，见 api.js 注释）。
  const api = createDreamApi();
  const notify = typeof context.notify === 'function' ? context.notify : null;
  const controller = new AbortController();
  const styleNode = ensureStyle();

  let disposed = false;
  let ui = null;
  let pollTimer = null;
  let pollInFlight = false;
  let pollDeadline = 0;

  const store = {
    phase: 'checking',
    me: null,
    snapshot: null,
    startupError: null,
    blockedMessage: '',
    loginMessage: '',
    loginMessageKind: 'error',
    accountDraft: '',
    banner: null,
    filter: { query: '', status: 'all' },
    refreshing: false,
    refreshBaseline: null,
    detail: emptyDetail(),
  };

  root.classList.add('dse-root');
  root.setAttribute('data-module', manifest.id);

  /* ---------------------------- 事件处理 ---------------------------- */

  function onClick(event) {
    const target = event.target.closest('[data-action]');
    if (!target || !root.contains(target)) return;
    const action = target.getAttribute('data-action');
    const aid = target.getAttribute('data-aid') || '';

    if (action === 'refresh') {
      void handleRefresh();
    } else if (action === 'logout') {
      void handleLogout();
    } else if (action === 'detail') {
      if (aid) openDetail(aid);
    } else if (action === 'detail-retry') {
      if (aid) void requestDetail(aid);
    } else if (action === 'detail-close') {
      closeDialog();
    } else if (action === 'retry-check') {
      void bootstrap();
    }
  }

  function onSubmit(event) {
    const form = event.target.closest('form[data-role="login-form"]');
    if (!form) return;
    event.preventDefault();
    void submitLogin(form);
  }

  function onInput(event) {
    const input = event.target.closest('[data-role="search"]');
    if (!input) return;
    store.filter.query = input.value;
    renderList();
  }

  function onChange(event) {
    const select = event.target.closest('[data-role="status"]');
    if (!select) return;
    store.filter.status = select.value;
    renderList();
  }

  root.addEventListener('click', onClick);
  root.addEventListener('submit', onSubmit);
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);

  /* ---------------------------- 数据流程 ---------------------------- */

  async function bootstrap() {
    store.phase = 'checking';
    store.startupError = null;
    store.blockedMessage = '';
    store.loginMessage = '';
    store.loginMessageKind = 'error';
    store.banner = null;
    render();

    try {
      const me = await api.me(controller.signal);
      if (disposed) return;
      store.me = me && typeof me === 'object' ? me : null;
    } catch (error) {
      if (disposed || isAbort(error)) return;
      handleApiFailure(error, { initial: true });
      return;
    }

    await loadState({ initial: true });
  }

  async function loadState({ initial = false } = {}) {
    try {
      const snapshot = await api.state(controller.signal);
      if (disposed) return;
      applySnapshot(snapshot);
      store.phase = 'ready';
      store.startupError = null;
      store.loginMessage = '';
      render();
      if (store.snapshot?.busy && !pollTimer) {
        if (store.refreshBaseline === null) {
          store.refreshBaseline = Number.isFinite(store.snapshot.last_sync) ? store.snapshot.last_sync : null;
        }
        startPolling();
      }
    } catch (error) {
      if (disposed || isAbort(error)) return;
      if (error.code === 'backend_token_leak') {
        showBlocked(error.message);
        return;
      }
      handleApiFailure(error, { initial });
    }
  }

  function applySnapshot(snapshot) {
    store.snapshot = snapshot;
    if (snapshot?.me && typeof snapshot.me === 'object') {
      store.me = snapshot.me;
    }
  }

  function handleApiFailure(error, { initial = false } = {}) {
    if (error?.code === 'backend_token_leak') {
      showBlocked(error.message);
      return;
    }
    if (error?.needLogin) {
      enterLogin(error.message || '请先登录 dream-monitor 后查看活动。');
      return;
    }
    if (!initial && store.phase === 'ready') {
      store.banner = { kind: 'error', text: `状态读取失败：${error.message}` };
      renderBanner();
      return;
    }
    if (error?.code === 'not_connected' || error?.code === 'not_found' || error?.status === 404) {
      store.phase = 'unavailable';
    } else {
      store.phase = 'error';
    }
    store.startupError = error;
    render();
  }

  function showBlocked(message) {
    stopPolling();
    store.refreshing = false;
    store.phase = 'blocked';
    store.blockedMessage = message || '后端仍返回上游 token，已停止读取活动数据。';
    store.snapshot = null;
    render();
  }

  function enterLogin(message = '', kind = 'info') {
    stopPolling();
    store.phase = 'login';
    store.loginMessage = message;
    store.loginMessageKind = kind;
    store.snapshot = null;
    store.refreshing = false;
    store.banner = null;
    store.detail = emptyDetail();
    render();
    focusLoginPassword();
  }

  function focusLoginPassword() {
    setTimeout(() => {
      if (disposed || store.phase !== 'login') return;
      const input = root.querySelector('input[name="password"]');
      if (input) input.focus();
    }, 30);
  }

  async function submitLogin(form) {
    const accountInput = form.elements.namedItem('account');
    const passwordInput = form.elements.namedItem('password');
    const account = String(accountInput?.value || '').trim();
    const password = String(passwordInput?.value || '');

    store.accountDraft = account;
    if (passwordInput) passwordInput.value = '';

    if (!account || !password) {
      store.loginMessage = '请输入到梦空间账号和密码。';
      store.loginMessageKind = 'error';
      render();
      focusLoginPassword();
      return;
    }

    store.loginMessage = '';
    const button = form.querySelector('button[type="submit"]');
    if (button) {
      button.disabled = true;
      button.textContent = '登录中…';
    }

    try {
      const result = await api.login(account, password, controller.signal);
      if (disposed) return;
      if (result && result.ok === false) {
        throw new DreamApiError(String(result.error || '登录失败'), {
          code: 'login_failed',
          retryable: false,
        });
      }

      if (!store.me) {
        try {
          const me = await api.me(controller.signal);
          if (disposed) return;
          store.me = me && typeof me === 'object' ? me : null;
        } catch {
          // 会话可能已建立但 /api/me 暂不可用，交给 /api/state 的 me 字段补齐。
        }
      }

      await loadState({ initial: true });
      if (disposed) return;
      if (store.phase === 'ready') {
        store.banner = { kind: 'success', text: '已登录 dream-monitor。' };
        render();
        if (notify) notify('已登录 dream-monitor');
      }
    } catch (error) {
      if (disposed || isAbort(error)) return;
      store.phase = 'login';
      store.loginMessage = error.message || '登录失败，请重试。';
      store.loginMessageKind = 'error';
      render();
      focusLoginPassword();
    }
  }

  async function handleLogout() {
    const button = ui?.logoutButton;
    if (button) {
      button.disabled = true;
      button.textContent = '退出中…';
    }
    try {
      await api.logout();
    } catch (error) {
      if (disposed || isAbort(error)) return;
      // 退出请求失败时不能只清空界面就宣称服务端已退出。
      if (button) {
        button.disabled = false;
        button.textContent = '退出登录';
      }
      store.banner = {
        kind: 'error',
        text: `退出失败：${error.message}。服务端会话可能仍然有效，请重试或关闭浏览器。`,
      };
      renderBanner();
      return;
    }
    if (disposed) return;

    // 退出后确认服务端会话确实失效：/api/me 应返回 401。
    let verify = 'ok';
    try {
      const me = await api.me(controller.signal);
      if (disposed) return;
      if (me && typeof me === 'object' && hasValue(me.uid)) verify = 'alive';
    } catch (error) {
      if (disposed || isAbort(error)) return;
      verify = error?.needLogin ? 'ok' : 'unknown';
    }

    store.me = null;
    store.snapshot = null;
    store.banner = null;
    store.filter = { query: '', status: 'all' };
    store.refreshBaseline = null;
    store.detail = emptyDetail();

    if (verify === 'ok') {
      enterLogin('已退出登录，服务端会话已失效。', 'info');
    } else if (verify === 'alive') {
      enterLogin('退出请求已完成，但服务端仍返回有效会话；请稍后重试退出。', 'error');
    } else {
      enterLogin('已发送退出请求，但未能确认服务端会话状态；如仍能看到活动，请重新退出。', 'error');
    }
  }

  async function handleRefresh() {
    if (store.refreshing || store.snapshot?.busy) return;
    store.refreshing = true;
    store.refreshBaseline = Number.isFinite(store.snapshot?.last_sync) ? store.snapshot.last_sync : null;
    store.banner = null;
    renderBanner();
    renderControls();

    try {
      await api.refresh(controller.signal);
      if (disposed) return;
      store.banner = { kind: 'info', text: '同步任务已启动，正在等待后台完成…' };
      renderBanner();
      startPolling();
    } catch (error) {
      if (disposed || isAbort(error)) return;
      store.refreshing = false;
      if (error.needLogin) {
        enterLogin(error.message || '会话已过期，请重新登录。');
        return;
      }
      store.banner = { kind: 'error', text: `刷新失败：${error.message}` };
      renderBanner();
      renderControls();
    }
  }

  function startPolling() {
    if (disposed || pollTimer) return;
    store.refreshing = true;
    pollDeadline = Date.now() + REFRESH_TIMEOUT_MS;
    renderControls();
    pollTimer = setInterval(() => {
      void pollOnce();
    }, POLL_INTERVAL_MS);
    void pollOnce();
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    pollInFlight = false;
  }

  async function pollOnce() {
    if (disposed || pollInFlight) return;
    if (Date.now() > pollDeadline) {
      stopPolling();
      store.refreshing = false;
      store.banner = {
        kind: 'warn',
        text: '同步仍在后台进行，已停止自动等待；可稍后手动刷新查看结果。',
      };
      renderBanner();
      renderControls();
      return;
    }

    pollInFlight = true;
    try {
      const snapshot = await api.state(controller.signal);
      if (disposed) return;
      applySnapshot(snapshot);

      if (!snapshot.busy) {
        stopPolling();
        store.refreshing = false;
        // busy=false 只代表后台线程结束，任务本身可能失败；用 last_sync 是否推进来判断。
        const outcome = classifyRefreshResult(store.refreshBaseline, snapshot);
        if (outcome.status === 'done') {
          store.banner = { kind: 'success', text: '活动列表已同步。' };
        } else if (outcome.status === 'partial') {
          store.banner = {
            kind: 'warn',
            text: `已同步，但 ${outcome.unknown} 条活动的名额/详情暂未读取完成；可稍后再次刷新。`,
          };
        } else if (Number.isFinite(outcome.lastSync)) {
          store.banner = {
            kind: 'error',
            text: `本次同步未成功，页面仍显示 ${formatSyncTime(outcome.lastSync)} 的旧数据；可重试刷新。`,
          };
        } else {
          store.banner = {
            kind: 'error',
            text: '本次同步未成功，服务端尚未返回有效的同步时间；可重试刷新。',
          };
        }
      } else {
        store.banner = null;
      }

      if (store.phase !== 'ready') {
        store.phase = 'ready';
        render();
        return;
      }
      renderBanner();
      renderMeta();
      renderList();
      renderControls();
    } catch (error) {
      if (disposed || isAbort(error)) return;
      stopPolling();
      store.refreshing = false;
      if (error.code === 'backend_token_leak') {
        showBlocked(error.message);
        return;
      }
      if (error.needLogin) {
        enterLogin(error.message || '会话已过期，请重新登录。');
        return;
      }
      store.banner = { kind: 'error', text: `同步状态读取失败：${error.message}` };
      renderBanner();
      renderControls();
    } finally {
      pollInFlight = false;
    }
  }

  /* ---------------------------- 详情 ---------------------------- */

  function openDetail(aid) {
    if (!ui?.dialog) return;
    store.detail = { aid, loading: true, data: null, error: null };
    renderDetail();
    if (typeof ui.dialog.showModal === 'function') {
      if (!ui.dialog.open) ui.dialog.showModal();
    } else {
      ui.dialog.setAttribute('open', '');
    }
    void requestDetail(aid);
  }

  function closeDialog() {
    if (!ui?.dialog) return;
    if (typeof ui.dialog.close === 'function' && ui.dialog.open) {
      ui.dialog.close();
    } else {
      ui.dialog.removeAttribute('open');
    }
    store.detail = emptyDetail();
    renderDetail();
  }

  async function requestDetail(aid) {
    store.detail = { aid, loading: true, data: null, error: null };
    renderDetail();

    try {
      const data = await api.activity(aid, controller.signal);
      if (disposed || store.detail.aid !== aid) return;
      if (!data || typeof data !== 'object') {
        throw new DreamApiError('详情响应格式不正确', { code: 'bad_payload', retryable: true });
      }
      store.detail = { aid, loading: false, data, error: null };
      renderDetail();
    } catch (error) {
      if (disposed || isAbort(error) || store.detail.aid !== aid) return;
      if (error.needLogin) {
        enterLogin(error.message || '会话已过期，请重新登录。');
        return;
      }
      store.detail = { aid, loading: false, data: null, error };
      renderDetail();
    }
  }

  /* ---------------------------- 渲染 ---------------------------- */

  function render() {
    if (disposed) return;
    if (store.phase === 'ready') {
      if (!ui) buildDashboard();
      updateDashboard();
      return;
    }
    ui = null;
    if (store.phase === 'checking') renderChecking();
    else if (store.phase === 'login') renderLogin();
    else if (store.phase === 'blocked') renderBlocked();
    else if (store.phase === 'unavailable') renderUnavailable();
    else renderError();
  }

  function panelPage(children) {
    return el('div', { className: 'dse-page' }, [
      el('div', { className: 'dse-panel' }, children),
    ]);
  }

  function renderChecking() {
    root.replaceChildren(
      panelPage([
        el('h2', { className: 'dse-heading', text: '到梦空间活动' }),
        el('p', { className: 'dse-sub', text: '正在检查 dream-monitor 会话…' }),
        el('div', { className: 'dse-loading', attrs: { role: 'status', 'aria-live': 'polite' } }, [
          el('span', { className: 'dse-spinner', attrs: { 'aria-hidden': 'true' } }),
          el('span', { text: '正在连接同源 /api/me' }),
        ]),
      ])
    );
  }

  function renderLogin() {
    const errorText = hasValue(store.loginMessage) ? String(store.loginMessage) : '';
    const form = el('form', { className: 'dse-form', attrs: { 'data-role': 'login-form', novalidate: 'novalidate' } }, [
      el('label', { className: 'dse-field' }, [
        el('span', { className: 'dse-label', text: '到梦空间账号' }),
        el('input', {
          className: 'dse-input',
          attrs: {
            type: 'text',
            name: 'account',
            autocomplete: 'username',
            required: 'required',
            placeholder: '手机号或账号',
            value: store.accountDraft,
          },
        }),
      ]),
      el('label', { className: 'dse-field' }, [
        el('span', { className: 'dse-label', text: '密码' }),
        el('input', {
          className: 'dse-input',
          attrs: {
            type: 'password',
            name: 'password',
            autocomplete: 'current-password',
            required: 'required',
            placeholder: '仅发送给 dream-monitor',
          },
        }),
      ]),
      errorText
        ? el('p', {
            className: store.loginMessageKind === 'info' ? 'dse-hint' : 'dse-form-error',
            attrs: { role: 'alert' },
            text: errorText,
          })
        : null,
      el('button', { className: 'dse-btn', attrs: { type: 'submit' }, text: '登录' }),
      el('p', {
        className: 'dse-hint',
        text: LOGIN_FORM_COPY,
      }),
    ]);

    root.replaceChildren(
      panelPage([
        el('div', { className: 'dse-login-wrap' }, [
          el('div', {}, [
            el('h2', { className: 'dse-heading', text: '登录到梦空间活动查询' }),
            el('p', {
              className: 'dse-sub',
              text: '活动数据来自已部署的 dream-monitor 服务。本模块只读，不提供报名或取消报名。',
            }),
            form,
          ]),
          el('aside', { className: 'dse-aside' }, [
            el('strong', { text: '连接前提' }),
            el('ul', {}, [
              el('li', { text: 'dream-monitor 网页 API 与本页面同源部署。' }),
              el('li', { text: '后端 /api/state 已删除顶层 token 字段。' }),
              el('li', { text: '仅查询活动列表和详情，不调用报名/取消接口。' }),
            ]),
          ]),
        ]),
      ])
    );
  }

  function statePanel(title, message, error, actionText = '重新检查') {
    const children = [
      el('h2', { className: 'dse-state-title', text: title }),
      el('p', { className: 'dse-state-text', text: message }),
    ];
    if (error?.message) {
      children.push(el('p', { className: 'dse-state-code', text: `状态：${error.message}` }));
    }
    children.push(
      el('div', {}, [
        el('button', {
          className: 'dse-btn',
          attrs: { type: 'button', 'data-action': 'retry-check' },
          text: actionText,
        }),
      ])
    );
    root.replaceChildren(panelPage(children));
  }

  function renderUnavailable() {
    statePanel(
      '活动服务暂不可用',
      '当前运行环境无法访问同源的 dream-monitor 网页 API（/api/me 连接失败、超时或不是 JSON）。请确认后端已启动、DREAM_MONITOR_TARGET 配置正确后重试。本模块不会用静态数据冒充活动结果。',
      store.startupError,
      '重试连接'
    );
  }

  function renderError() {
    statePanel('活动数据读取失败', store.startupError?.message || '读取 dream-monitor 状态失败。', store.startupError);
  }

  function renderBlocked() {
    statePanel(
      '已停止接入：后端仍返回上游 token',
      '检测到 /api/state 仍包含顶层 token。为避免浏览器接触上游凭据，本模块拒绝展示任何活动数据。请先在 dream-monitor 后端删除该字段，并确认响应中不再出现 token 后再接入。',
      { message: 'backend_token_leak' }
    );
  }

  function buildDashboard() {
    const page = el('div', { className: 'dse-page' });

    const user = el('span', { className: 'dse-user' });
    const refreshButton = el('button', {
      className: 'dse-btn',
      attrs: { type: 'button', 'data-action': 'refresh' },
      text: '刷新活动',
    });
    const logoutButton = el('button', {
      className: 'dse-btn dse-btn-secondary',
      attrs: { type: 'button', 'data-action': 'logout' },
      text: '退出登录',
    });

    const banner = el('div', {
      className: 'dse-banner dse-banner-info',
      attrs: { role: 'status', 'aria-live': 'polite', hidden: 'hidden' },
    });
    const sync = el('span');
    const stats = el('div', { className: 'dse-stats' });

    const search = el('input', {
      className: 'dse-input',
      attrs: {
        type: 'search',
        placeholder: '搜索活动名称、类别、主办或地点',
        'aria-label': '搜索活动',
        'data-role': 'search',
      },
    });
    const status = el(
      'select',
      {
        className: 'dse-select',
        attrs: { 'aria-label': '按状态筛选', 'data-role': 'status' },
      },
      [
        ['all', '全部状态'],
        ['open', '报名中'],
        ['full', '已满'],
        ['soon', '即将开始'],
        ['running', '进行中'],
        ['unknown', '未知'],
      ].map(([value, label]) => el('option', { text: label, attrs: { value } }))
    );
    const count = el('span', { className: 'dse-count' });
    const list = el('div', { className: 'dse-list' });

    const dialog = el('dialog', {
      className: 'dse-dialog',
      attrs: { 'aria-label': '活动详情' },
    });
    const dialogBody = el('div', { className: 'dse-dialog-body' });
    dialog.append(dialogBody);
    dialog.addEventListener('close', () => {
      store.detail = emptyDetail();
      renderDetail();
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) closeDialog();
    });

    page.append(
      el('div', { className: 'dse-topbar' }, [
        el('div', {}, [
          el('h2', { className: 'dse-heading', text: '到梦空间活动' }),
          el('p', {
            className: 'dse-sub',
            text: '只读查询 · 数据来自已部署的 dream-monitor · 不提供报名/取消操作',
          }),
        ]),
        el('div', { className: 'dse-session' }, [user, refreshButton, logoutButton]),
      ]),
      banner,
      el('div', { className: 'dse-meta' }, [sync, stats]),
      el('div', { className: 'dse-controls' }, [search, status, count]),
      list,
      dialog
    );

    ui = { page, user, refreshButton, logoutButton, banner, sync, stats, search, status, count, list, dialog, dialogBody };
    root.replaceChildren(page);
  }

  function updateDashboard() {
    if (!ui) return;
    renderUser();
    renderBanner();
    renderMeta();
    renderControls();
    renderList();
    renderDetail();

    if (document.activeElement !== ui.search && ui.search.value !== store.filter.query) {
      ui.search.value = store.filter.query;
    }
    if (ui.status.value !== store.filter.status) {
      ui.status.value = store.filter.status;
    }
  }

  function renderUser() {
    if (!ui?.user) return;
    const me = store.me || store.snapshot?.me || {};
    const parts = [me.name, me.school].filter(hasValue).map((part) => String(part));
    ui.user.textContent = parts.length ? parts.join(' · ') : '已登录';
  }

  function effectiveBanner() {
    if (store.banner) return store.banner;
    const snapshot = store.snapshot;
    if (!snapshot) return null;
    if (snapshot.busy) {
      const progress = progressLabel(snapshot.progress);
      return {
        kind: 'info',
        text: `正在同步活动列表…${progress ? ` ${progress}` : ''}`,
      };
    }
    if (snapshot.enriching) {
      const progress = progressLabel(snapshot.progress);
      return {
        kind: 'info',
        text: `正在补充活动详情…${progress ? ` ${progress}` : ''}`,
      };
    }
    if (snapshot.auth && snapshot.auth.stale && hasValue(snapshot.auth.msg)) {
      return { kind: 'warn', text: String(snapshot.auth.msg) };
    }
    return null;
  }

  function renderBanner() {
    if (!ui?.banner) return;
    const banner = effectiveBanner();
    if (!banner) {
      ui.banner.setAttribute('hidden', 'hidden');
      ui.banner.textContent = '';
      return;
    }
    ui.banner.className = `dse-banner dse-banner-${banner.kind || 'info'}`;
    ui.banner.textContent = banner.text || '';
    ui.banner.removeAttribute('hidden');
  }

  function renderMeta() {
    if (!ui?.sync) return;
    const snapshot = store.snapshot || {};
    let syncText = `最近同步：${formatSyncTime(snapshot.last_sync)}`;
    if (typeof snapshot.stale_secs === 'number' && Number.isFinite(snapshot.stale_secs)) {
      syncText += `（快照约 ${Math.max(0, Math.round(snapshot.stale_secs))} 秒前）`;
    }
    ui.sync.textContent = syncText;

    const stats = snapshot.stats && typeof snapshot.stats === 'object' ? snapshot.stats : null;
    if (!stats) {
      ui.stats.replaceChildren(el('span', { className: 'dse-stat', text: '统计未提供' }));
      return;
    }
    const entries = [
      ['total', '已抓取'],
      ['live', '未结束'],
      ['open', '报名中'],
      ['soon', '即将开始'],
      ['running', '进行中'],
      ['ended', '已结束'],
    ];
    const nodes = [];
    for (const [key, label] of entries) {
      const value = stats[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        nodes.push(
          el('span', { className: 'dse-stat' }, [el('b', { text: value }), document.createTextNode(` ${label}`)])
        );
      }
    }
    ui.stats.replaceChildren(...(nodes.length ? nodes : [el('span', { className: 'dse-stat', text: '统计未提供' })]));
  }

  function renderControls() {
    if (!ui?.refreshButton) return;
    const busy = Boolean(store.snapshot?.busy);
    const locked = store.refreshing || busy;
    ui.refreshButton.disabled = locked;
    ui.refreshButton.textContent = locked ? '同步中…' : '刷新活动';
    ui.logoutButton.disabled = false;
  }

  function cardFact(text, warn = false) {
    return el('span', { className: `dse-fact${warn ? ' dse-fact-warn' : ''}`, text });
  }

  function renderCard(item) {
    const name = hasValue(item.name) ? String(item.name) : '未命名活动';
    const aid = hasValue(item.aid) ? String(item.aid) : '';
    const title = aid
      ? el('button', {
          className: 'dse-card-title',
          attrs: { type: 'button', 'data-action': 'detail', 'data-aid': aid },
          text: name,
        })
      : el('span', { className: 'dse-card-title', text: name });

    const head = el('div', { className: 'dse-card-head' }, [
      title,
      el('span', {
        className: `dse-badge dse-badge-${stateTone(item.state)}`,
        text: stateLabel(item.state),
      }),
    ]);

    const metaParts = [item.category, item.organizer].filter(hasValue).map((part) => String(part));
    const meta = metaParts.length
      ? el('p', { className: 'dse-card-meta', text: metaParts.join(' · ') })
      : null;

    const facts = [];
    facts.push(cardFact(`名额：${quotaText(item.quota)}`, item.quota === -2 || item.quota === 0));
    if (hasValue(item.joined) || hasValue(item.capacity)) {
      const joined = hasValue(item.joined) ? numberText(item.joined) : '未提供';
      const capacity = hasValue(item.capacity) ? numberText(item.capacity) : '未提供';
      facts.push(cardFact(`已报名 ${joined} / ${capacity}`));
    }
    const signupRange = rangeText('报名', item.sign_start, item.sign_end);
    if (signupRange) facts.push(cardFact(signupRange));
    if (hasValue(item.act_start)) {
      facts.push(cardFact(`活动开始 ${formatTime(item.act_start)}`));
    }
    if (hasValue(item.address)) facts.push(cardFact(`地点 ${String(item.address)}`));
    if (hasValue(item.credit)) facts.push(cardFact(`积分 ${String(item.credit)}`));
    if (item.joined_by_me === true) facts.push(cardFact('我已报名'));

    const actions = el('div', { className: 'dse-card-actions' }, [
      aid
        ? el('button', {
            className: 'dse-btn dse-btn-secondary dse-btn-small',
            attrs: { type: 'button', 'data-action': 'detail', 'data-aid': aid },
            text: '查看详情',
          })
        : el('span', { className: 'dse-card-meta', text: '接口未返回活动 ID，无法读取详情' }),
    ]);

    return el('article', { className: 'dse-card' }, [head, meta, el('div', { className: 'dse-facts' }, facts), actions]);
  }

  function renderList() {
    if (!ui?.list) return;
    const snapshot = store.snapshot || {};
    const items = Array.isArray(snapshot.items) ? snapshot.items : [];
    const filtered = filterItems(items, store.filter);

    const summary = [];
    summary.push(`共 ${items.length} 条未结束活动`);
    if (filtered.length !== items.length) summary.push(`筛选后 ${filtered.length} 条`);
    ui.count.textContent = summary.join('，');

    if (!items.length) {
      ui.list.replaceChildren(
        el('div', { className: 'dse-empty', text: '当前没有未结束的活动。接口只返回未结束项目。' })
      );
      return;
    }
    if (!filtered.length) {
      ui.list.replaceChildren(
        el('div', { className: 'dse-empty', text: '没有符合搜索或状态筛选条件的活动。' })
      );
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const item of filtered) fragment.append(renderCard(item));
    ui.list.replaceChildren(fragment);
  }

  function renderDetail() {
    if (!ui?.dialogBody) return;
    const detail = store.detail || emptyDetail();
    const body = ui.dialogBody;

    if (!detail.aid) {
      body.replaceChildren();
      return;
    }

    if (detail.loading) {
      body.replaceChildren(
        el('div', { className: 'dse-dialog-head' }, [
          el('h3', { className: 'dse-dialog-title', text: '活动详情' }),
          el('button', {
            className: 'dse-dialog-close',
            attrs: { type: 'button', 'data-action': 'detail-close', 'aria-label': '关闭详情' },
            text: '×',
          }),
        ]),
        el('div', { className: 'dse-loading', attrs: { role: 'status' } }, [
          el('span', { className: 'dse-spinner', attrs: { 'aria-hidden': 'true' } }),
          el('span', { text: '正在读取活动详情…' }),
        ])
      );
      return;
    }

    if (detail.error) {
      body.replaceChildren(
        el('div', { className: 'dse-dialog-head' }, [
          el('h3', { className: 'dse-dialog-title', text: '活动详情加载失败' }),
          el('button', {
            className: 'dse-dialog-close',
            attrs: { type: 'button', 'data-action': 'detail-close', 'aria-label': '关闭详情' },
            text: '×',
          }),
        ]),
        el('p', { className: 'dse-detail-error', text: detail.error.message || '读取详情失败。' }),
        el('div', { className: 'dse-card-actions' }, [
          el('button', {
            className: 'dse-btn',
            attrs: { type: 'button', 'data-action': 'detail-retry', 'data-aid': detail.aid },
            text: '重试',
          }),
          el('button', {
            className: 'dse-btn dse-btn-secondary',
            attrs: { type: 'button', 'data-action': 'detail-close' },
            text: '关闭',
          }),
        ])
      );
      return;
    }

    const data = detail.data || {};
    const name = hasValue(data.activityName) ? String(data.activityName) : `活动 ${detail.aid}`;
    const listItem = store.snapshot?.items?.find((item) => String(item.aid) === String(detail.aid));

    const head = el('div', { className: 'dse-dialog-head' }, [
      el('h3', { className: 'dse-dialog-title', text: name }),
      el('button', {
        className: 'dse-dialog-close',
        attrs: { type: 'button', 'data-action': 'detail-close', 'aria-label': '关闭详情' },
        text: '×',
      }),
    ]);

    const statusFacts = [];
    if (listItem && hasValue(listItem.state)) {
      statusFacts.push(
        el('span', {
          className: `dse-badge dse-badge-${stateTone(listItem.state)}`,
          text: stateLabel(listItem.state),
        })
      );
    }
    if (hasValue(data.statusText)) statusFacts.push(cardFact(`接口状态：${String(data.statusText)}`));

    const counts = [];
    if (hasValue(data.joinNum)) counts.push(cardFact(`已报名：${numberText(data.joinNum)}`));
    if (hasValue(data.joinmaxnum)) counts.push(cardFact(`名额上限：${numberText(data.joinmaxnum)}`));

    const signupId = String(data.signUpId ?? '').trim();
    const hasSignupRecord = hasValue(signupId) && signupId !== '0';
    counts.push(
      cardFact(
        hasSignupRecord
          ? '报名记录：已检测到当前账号的报名记录（signUpId 非空）'
          : '报名记录：未检测到（signUpId 为空或 0）',
        !hasSignupRecord
      )
    );
    if (typeof data.canJoin === 'boolean') {
      counts.push(cardFact(`上游标记可报名：${boolText(data.canJoin)}`));
    }
    if (typeof data.ableJoinFlag === 'boolean') {
      counts.push(cardFact(`上游资格标记：${boolText(data.ableJoinFlag)}`));
    }

    const rows = DETAIL_ROWS.map(([key, label]) => {
      const value = data[key];
      if (!hasValue(value)) return null;
      const text = DATE_DETAIL_KEYS.has(key) ? formatTime(value) : String(value);
      return [
        el('span', { className: 'dse-detail-key', text: label }),
        el('span', { className: 'dse-detail-value', text }),
      ];
    }).filter(Boolean);

    const grid = rows.length
      ? el('div', { className: 'dse-detail-grid' }, rows.flat())
      : el('p', { className: 'dse-card-meta', text: '接口未返回可展示的详情字段。' });

    body.replaceChildren(
      ...[
        head,
        statusFacts.length ? el('div', { className: 'dse-detail-status' }, statusFacts) : null,
        counts.length ? el('div', { className: 'dse-detail-counts' }, counts) : null,
        grid,
        el('p', {
          className: 'dse-detail-foot',
          text: '仅显示 dream-monitor 已确认的详情白名单字段，不展示图片或富文本正文。本页不提供报名/取消操作。',
        }),
      ].filter(Boolean)
    );
  }

  /* ---------------------------- 生命周期 ---------------------------- */

  render();
  void bootstrap();

  return function unmount() {
    if (disposed) return;
    disposed = true;
    stopPolling();
    controller.abort();
    root.removeEventListener('click', onClick);
    root.removeEventListener('submit', onSubmit);
    root.removeEventListener('input', onInput);
    root.removeEventListener('change', onChange);
    if (ui?.dialog?.open) {
      try {
        ui.dialog.close();
      } catch {
        // 忽略关闭异常，继续清理。
      }
    }
    ui = null;
    root.classList.remove('dse-root');
    root.removeAttribute('data-module');
    root.replaceChildren();
    if (styleNode && styleNode.isConnected && !document.querySelector('.dse-root')) {
      styleNode.remove();
    }
  };
}

export default { manifest, mount };
