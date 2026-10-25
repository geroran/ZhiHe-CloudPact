const DEFAULT_TIMEOUT_MS = 120000;

function failure(code, message, retryable = false) {
  return { ok: false, error: { code, message, retryable } };
}

function normalizeTimeout(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

/**
 * 校园 AI 智能体客户端。
 * - direct：浏览器直连上游，Apikey 由 Vite 环境变量注入（仅限封闭演示）。
 * - proxy：浏览器只请求同源 `/api/agent/<endpoint>`，凭据保留在服务端。
 * 统一返回 { ok: true, data } / { ok: false, error }。
 * @param {object} config
 * @param {Function} [fetchImpl] 可注入的 fetch 实现，便于测试
 */
export function createApiClient(config = {}, fetchImpl = globalThis.fetch) {
  const transport = config.transport === 'proxy' ? 'proxy' : 'direct';
  const origin = typeof config.origin === 'string' ? config.origin.replace(/\/+$/, '') : '';
  const appId = typeof config.appId === 'string' ? config.appId.trim() : '';
  const apiKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : '';
  const defaultTimeout = normalizeTimeout(config.timeoutMs);

  function mapStatus(status) {
    if (status === 401 || status === 403) {
      return failure('UNAUTHORIZED', '智能体接口鉴权失败，请检查本地 Apikey 配置。');
    }
    if (status === 429) {
      return failure('RATE_LIMITED', '智能体接口请求过于频繁，请稍后重试。', true);
    }
    if (status >= 500) {
      return failure('UPSTREAM_ERROR', `智能体服务返回错误（HTTP ${status}）。`, true);
    }
    return failure('HTTP_ERROR', `智能体接口请求失败（HTTP ${status}）。`, true);
  }

  async function request(endpoint, options = {}) {
    const name = String(endpoint || '').replace(/^\/+/, '');
    if (!name) return failure('INVALID_ARGUMENT', '缺少智能体接口名称。');

    if (transport === 'direct' && (!origin || !appId || !apiKey)) {
      return failure('CONFIG_INCOMPLETE', '浏览器直连缺少 AGENT_ORIGIN、AGENT_APP_ID 或 AGENT_API_KEY。');
    }

    const controller = new AbortController();
    const timeoutMs = normalizeTimeout(options.timeoutMs || defaultTimeout);
    let timedOut = false;
    let externallyAborted = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const externalSignal = options.signal;
    const onAbort = () => {
      externallyAborted = true;
      controller.abort();
    };
    if (externalSignal) {
      if (externalSignal.aborted) onAbort();
      else externalSignal.addEventListener('abort', onAbort, { once: true });
    }

    const headers = { Accept: 'application/json', ...(options.headers || {}) };
    const body = options.body;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let url;
    if (transport === 'direct') {
      url = `${origin}/api/proxy/api/v1/${name}?appid=${encodeURIComponent(appId)}`;
      headers.Apikey = apiKey;
    } else {
      url = `/api/agent/${name}`;
    }

    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal,
      });

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (contentType.includes('text/event-stream')) {
        return failure('PROTOCOL_MISMATCH', '接口返回了 SSE 流，请使用流式接口解析。');
      }

      const text = await response.text();
      let payload = null;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          return failure('BAD_RESPONSE', `智能体服务返回非 JSON 响应（HTTP ${response.status}）。`, true);
        }
      }

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          return failure('UNAUTHORIZED', '智能体接口鉴权失败，请检查本地 Apikey 配置。');
        }
        if (response.status === 429) {
          return failure('RATE_LIMITED', '智能体接口请求过于频繁，请稍后重试。', true);
        }
        if (response.status >= 500) {
          return failure('UPSTREAM_ERROR', `智能体服务返回错误（HTTP ${response.status}）。`, true);
        }
        return failure('HTTP_ERROR', `智能体接口请求失败（HTTP ${response.status}）。`, true);
      }

      if (payload === null) {
        return failure('BAD_RESPONSE', '智能体服务返回空响应。', true);
      }

      return { ok: true, data: payload };
    } catch (error) {
      if (externallyAborted) return failure('ABORTED', '请求已取消。');
      if (timedOut) return failure('TIMEOUT', '智能体响应超时，请稍后重试。', true);
      return failure('NETWORK', '无法连接智能体服务：网络不可达，或浏览器跨域请求被拒绝。', true);
    } finally {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
    }
  }

  /**
   * 流式请求：读取 text/event-stream，按片段回调 onText。
   * 上游若返回 JSON（未支持流式），返回 STREAM_UNSUPPORTED 供调用方回退 blocking。
   */
  async function stream(endpoint, options = {}) {
    const name = String(endpoint || '').replace(/^\/+/, '');
    if (!name) return failure('INVALID_ARGUMENT', '缺少智能体接口名称。');
    if (transport === 'direct' && (!origin || !appId || !apiKey)) {
      return failure('CONFIG_INCOMPLETE', '浏览器直连缺少 AGENT_ORIGIN、AGENT_APP_ID 或 AGENT_API_KEY。');
    }

    const onText = options.onText;
    const controller = new AbortController();
    const timeoutMs = normalizeTimeout(options.timeoutMs || defaultTimeout);
    let timedOut = false;
    let externallyAborted = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const externalSignal = options.signal;
    const onAbort = () => {
      externallyAborted = true;
      controller.abort();
    };
    if (externalSignal) {
      if (externalSignal.aborted) onAbort();
      else externalSignal.addEventListener('abort', onAbort, { once: true });
    }

    const headers = {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };
    let url;
    if (transport === 'direct') {
      url = `${origin}/api/proxy/api/v1/${name}?appid=${encodeURIComponent(appId)}`;
      headers.Apikey = apiKey;
    } else {
      url = `/api/agent/${name}`;
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(options.body === undefined ? {} : options.body),
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal
      });

      if (!response.ok) {
        const text = await response.text();
        let payload = null;
        try {
          payload = text ? JSON.parse(text) : null;
        } catch {
          payload = null;
        }
        if (transport === 'proxy' && payload && typeof payload.ok === 'boolean') {
          if (payload.ok === false && payload.error) return payload;
          return failure('BAD_RESPONSE', '本地代理返回了非流式响应。', false);
        }
        return mapStatus(response.status);
      }

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (contentType.includes('application/json')) {
        return failure('STREAM_UNSUPPORTED', '上游未返回 SSE 流。', false);
      }

      if (!response.body || typeof response.body.getReader !== 'function') {
        const text = await response.text();
        if (text && typeof onText === 'function') onText(text);
        return { ok: true, data: null };
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && typeof onText === 'function') onText(decoder.decode(value, { stream: true }));
      }
      const tail = decoder.decode();
      if (tail && typeof onText === 'function') onText(tail);
      return { ok: true, data: null };
    } catch (error) {
      if (externallyAborted) return failure('ABORTED', '请求已取消。');
      if (timedOut) return failure('TIMEOUT', '智能体响应超时，请稍后重试。', true);
      return failure('NETWORK', '无法连接智能体服务：网络不可达，或浏览器跨域请求被拒绝。', true);
    } finally {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
    }
  }

  return { request, stream };
}

/** 同源通用请求客户端，供非智能体模块复用。 */
export function createSameOriginClient(base = '/api') {
  return {
    async request(path, options = {}) {
      const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
      const { method = 'GET', body, headers = {}, signal, ...rest } = options;
      try {
        const response = await fetch(url, {
          method,
          cache: 'no-store',
          credentials: 'same-origin',
          headers: {
            Accept: 'application/json',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...headers,
          },
          body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
          signal,
          ...rest,
        });

        const payload = await response.json().catch(() => null);
        if (payload && typeof payload.ok === 'boolean') return payload;

        return failure(
          response.ok ? 'BAD_RESPONSE' : `HTTP_${response.status}`,
          response.ok ? '接口返回格式异常' : `接口请求失败（HTTP ${response.status}）`,
          true
        );
      } catch (error) {
        const aborted = error?.name === 'AbortError';
        return failure(aborted ? 'ABORTED' : 'NETWORK_ERROR', aborted ? '请求已取消' : '网络请求失败，请稍后重试', !aborted);
      }
    },
  };
}
