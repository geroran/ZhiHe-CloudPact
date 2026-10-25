function failure(code, message, retryable = true) {
  return { ok: false, error: { code, message, retryable } };
}

function isEnvelope(value) {
  return Boolean(value && typeof value === 'object' && typeof value.ok === 'boolean');
}

/**
 * 默认同源请求。主站若注入 context.api.request（fetch 风格参数），则优先使用它。
 * 这样模块既能独立联调，也能在宿主中复用统一 API 客户端。
 */
async function sameOriginRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { Accept: 'application/json', ...(options.headers || {}) },
    cache: 'no-store',
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('服务返回非 JSON 响应');
  }
  return payload;
}

export function createMarketApi(contextApi) {
  const hostRequest =
    contextApi && typeof contextApi.request === 'function'
      ? contextApi.request.bind(contextApi)
      : null;

  async function request(path, options = {}) {
    try {
      const response = hostRequest
        ? await hostRequest(path, options)
        : await sameOriginRequest(path, options);
      if (!isEnvelope(response)) {
        return failure('BAD_RESPONSE', '服务返回格式异常');
      }
      return response;
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      return failure('NETWORK_ERROR', '无法连接服务端，请确认服务已启动后重试');
    }
  }

  return {
    getConfig(signal) {
      return request('/api/config', { method: 'GET', signal });
    },
    chat(payload, signal) {
      return request('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      });
    },
    latest(limit, signal) {
      return request(`/api/market/posts?limit=${encodeURIComponent(limit)}`, {
        method: 'GET',
        signal,
      });
    },
    hot(limit, signal) {
      return request(`/api/market/hot?limit=${encodeURIComponent(limit)}`, {
        method: 'GET',
        signal,
      });
    },
    search(keyword, page, signal) {
      return request(
        `/api/market/search?keyword=${encodeURIComponent(keyword)}&page=${encodeURIComponent(page)}`,
        { method: 'GET', signal },
      );
    },
  };
}
