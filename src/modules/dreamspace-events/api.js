/**
 * dream-monitor 同源网页 API 适配器。
 *
 * 仅包含规格中确认的会话/只读接口：
 *   POST /api/login  POST /api/logout  GET /api/me
 *   GET  /api/state  POST /api/refresh GET /api/activity?aid=...
 *
 * 不包含 /api/signup、/api/cancel 等写操作。
 */

export class DreamApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'DreamApiError';
    this.code = String(options.code || 'unknown');
    this.status = Number(options.status) || 0;
    this.retryable = options.retryable !== false;
    this.needLogin = options.needLogin === true;
  }
}

const NEED_LOGIN_CODES = new Set([
  '401',
  'unauthorized',
  'unauthorised',
  'need_login',
  'not_logged_in',
  'session_expired',
  'auth_required',
]);

function looksLikeNeedLogin(code, status, payload) {
  return (
    status === 401 ||
    NEED_LOGIN_CODES.has(String(code || '').toLowerCase()) ||
    payload?.need_login === true
  );
}

function httpMessage(payload, status) {
  if (typeof payload?.error === 'string' && payload.error) return payload.error;
  if (typeof payload?.message === 'string' && payload.message) return payload.message;
  return `dream-monitor 请求失败（HTTP ${status}）`;
}

/**
 * 浏览器直连同源 API。
 *
 * 不使用主站的 `context.api`：该客户端会把请求改写成 `/api/agent/${path}` 并固定 POST，
 * 与 dream-monitor 的 `/api/*` 契约不兼容。dream-monitor 必须与网页同源部署
 * （开发期由 Vite 代理，生产由同域反向代理），Cookie 才能以 HttpOnly + SameSite 生效。
 */
async function rawRequest(path, options = {}) {
  const { method = 'GET', body, signal } = options;
  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new DreamApiError('无法连接 dream-monitor 服务', {
      code: 'not_connected',
      retryable: true,
    });
  }

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      // 同源路径没有 JSON 响应，通常是服务未部署或被打包器回退成 HTML。
      throw new DreamApiError('未检测到 dream-monitor 同源 API（响应不是 JSON）', {
        code: 'not_connected',
        status: response.status,
        retryable: true,
      });
    }
  }

  if (!response.ok) {
    throw new DreamApiError(httpMessage(payload, response.status), {
      code: `http_${response.status}`,
      status: response.status,
      retryable: response.status >= 500 || response.status === 429,
      needLogin: looksLikeNeedLogin('', response.status, payload),
    });
  }

  return payload;
}

/**
 * `/api/state` 曾返回顶层 token（上游凭据）。规格要求后端删除该字段后才可接入；
 * 这里做硬校验：只要该字段仍存在（即便是空值）就拒绝读取，避免网页接触凭据。
 */
export function assertNoUpstreamToken(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new DreamApiError('活动状态响应格式不正确', {
      code: 'bad_payload',
      retryable: true,
    });
  }
  if (Object.prototype.hasOwnProperty.call(snapshot, 'token')) {
    // 规格要求后端彻底删除顶层 token；只要字段仍存在（即使是空值）就拒绝接入。
    throw new DreamApiError(
      'dream-monitor 的 /api/state 仍返回上游 token，已停止读取活动数据',
      { code: 'backend_token_leak', retryable: false }
    );
  }
  return snapshot;
}

export function createDreamApi() {
  async function call(path, options = {}, signal) {
    return rawRequest(path, { ...options, signal });
  }

  return {
    me(signal) {
      return call('/api/me', { method: 'GET' }, signal);
    },

    login(account, password, signal) {
      const user = String(account ?? '').trim();
      const pwd = String(password ?? '');
      if (!user || !pwd) {
        throw new DreamApiError('请输入到梦空间账号和密码', {
          code: 'bad_request',
          retryable: false,
        });
      }
      // force 使用后端默认值 false，页面不自动触发强制重登。
      return call('/api/login', { method: 'POST', body: { account: user, password: pwd } }, signal);
    },

    logout() {
      return call('/api/logout', { method: 'POST' });
    },

    async state(signal) {
      const snapshot = await call('/api/state', { method: 'GET' }, signal);
      return assertNoUpstreamToken(snapshot);
    },

    refresh(signal) {
      return call('/api/refresh', { method: 'POST', body: {} }, signal);
    },

    activity(aid, signal) {
      const id = String(aid ?? '').trim();
      if (!id) {
        throw new DreamApiError('缺少活动 ID', { code: 'bad_aid', retryable: false });
      }
      return call(`/api/activity?aid=${encodeURIComponent(id)}`, { method: 'GET' }, signal);
    },
  };
}
