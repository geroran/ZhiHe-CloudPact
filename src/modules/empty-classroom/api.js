/**
 * 空教室接口适配。
 *
 * 主站通过 context.api.request(path, options) 统一请求，约定返回 { ok, data } 或 { ok:false, error }。
 * 为便于独立运行，本适配器也接受上游原始响应 { success, data, detail }。
 * 两种结构都会归一化为 { ok:true, data } / { ok:false, message }。
 */

export const OPTIONS_PATH = '/hiagent/api/options';
export const QUERY_PATH = '/hiagent/api/query';

function messageFromError(error) {
  if (!error) return '请求失败';
  if (typeof error === 'string') return error;
  if (typeof error.message === 'string' && error.message) return error.message;
  return '请求失败';
}

function isAbortError(error) {
  return Boolean(error) && (error.name === 'AbortError' || error.code === 'ABORT_ERR');
}

function unwrap(result) {
  if (!result || typeof result !== 'object') {
    return { ok: false, message: '接口响应为空' };
  }

  if (typeof result.ok === 'boolean') {
    if (result.ok) return { ok: true, data: result.data };
    return { ok: false, message: messageFromError(result.error) };
  }

  if (typeof result.success === 'boolean') {
    if (result.success) return { ok: true, data: result.data };
    if (typeof result.detail === 'string' && result.detail) {
      return { ok: false, message: result.detail };
    }
    if (typeof result.message === 'string' && result.message) {
      return { ok: false, message: result.message };
    }
    return { ok: false, message: '接口返回 success=false' };
  }

  return { ok: false, message: '接口响应格式不符合预期' };
}

/**
 * 未提供主站 api 时的同源请求兜底。生产环境应由主站代理 /hiagent。
 */
export function createSameOriginRequester() {
  return async (path, options = {}) => {
    const response = await fetch(path, options);
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const detail = payload && (payload.detail || payload.message);
      return {
        ok: false,
        error: {
          code: `HTTP_${response.status}`,
          message: typeof detail === 'string' && detail ? detail : `HTTP ${response.status}`,
          retryable: true,
        },
      };
    }
    return payload;
  };
}

export function createRequester(context) {
  if (context && context.api && typeof context.api.request === 'function') {
    return (path, options) => context.api.request(path, options);
  }
  return createSameOriginRequester();
}

export function createEmptyClassroomApi(request) {
  if (typeof request !== 'function') {
    throw new TypeError('createEmptyClassroomApi 需要一个 request 函数');
  }

  return {
    async getOptions({ signal } = {}) {
      try {
        const result = await request(OPTIONS_PATH, { method: 'GET', signal });
        return unwrap(result);
      } catch (error) {
        if (isAbortError(error)) return { ok: false, aborted: true, message: '请求已取消' };
        return { ok: false, message: messageFromError(error) };
      }
    },

    async query(payload, { signal } = {}) {
      try {
        const result = await request(QUERY_PATH, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal,
        });
        return unwrap(result);
      } catch (error) {
        if (isAbortError(error)) return { ok: false, aborted: true, message: '请求已取消' };
        return { ok: false, message: messageFromError(error) };
      }
    },
  };
}
