const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_CONFIG_TIMEOUT_MS = 15000;

function configError(code, message) {
  return { ok: false, error: { code, message, retryable: false } };
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readViteEnv() {
  const env = import.meta.env;
  if (!env || typeof env !== 'object') return null;

  const transport = typeof env.VITE_AGENT_TRANSPORT === 'string'
    ? env.VITE_AGENT_TRANSPORT.trim()
    : '';
  const hasAnyConfig =
    transport ||
    env.VITE_AGENT_ORIGIN ||
    env.VITE_AGENT_APP_ID ||
    env.VITE_AGENT_API_KEY ||
    env.VITE_AGENT_USER_ID;
  if (!hasAnyConfig) return null;

  return {
    transport: transport || 'direct',
    origin: env.VITE_AGENT_ORIGIN,
    appId: env.VITE_AGENT_APP_ID,
    apiKey: env.VITE_AGENT_API_KEY,
    userId: env.VITE_AGENT_USER_ID,
    timeoutMs: env.VITE_AGENT_TIMEOUT_MS,
    configTimeoutMs: env.VITE_AGENT_CONFIG_TIMEOUT_MS
  };
}

/**
 * 读取运行配置：优先使用 window.__AGENT_CONFIG__（独立服务注入），
 * 其次读取 Vite 的 VITE_AGENT_* 环境变量（npm run dev / npm run build）。
 * 不在此处访问任何凭据文件。
 */
export function readRuntimeConfig(win = globalThis.window) {
  const raw = (win && win.__AGENT_CONFIG__) || readViteEnv();
  if (!raw || typeof raw !== 'object') {
    return configError(
      'CONFIG_MISSING',
      '运行配置未加载。请通过 npm run dev 启动，并在 .env.local 中配置 VITE_AGENT_* 变量。'
    );
  }

  const transport = raw.transport === 'proxy' ? 'proxy' : raw.transport === 'direct' ? 'direct' : null;
  if (!transport) {
    return configError('CONFIG_INVALID', '运行配置中的 AGENT_TRANSPORT 无效，只支持 direct 或 proxy。');
  }

  const userId = typeof raw.userId === 'string' ? raw.userId.trim() : '';
  const timeoutMs = positiveNumber(raw.timeoutMs, DEFAULT_TIMEOUT_MS);
  const configTimeoutMs = positiveNumber(raw.configTimeoutMs, DEFAULT_CONFIG_TIMEOUT_MS);

  if (transport === 'direct') {
    const origin = typeof raw.origin === 'string' ? raw.origin.trim().replace(/\/+$/, '') : '';
    const appId = typeof raw.appId === 'string' ? raw.appId.trim() : '';
    const apiKey = typeof raw.apiKey === 'string' ? raw.apiKey.trim() : '';
    if (!origin || !appId || !apiKey) {
      return configError(
        'CONFIG_INCOMPLETE',
        '浏览器直连模式缺少 VITE_AGENT_ORIGIN、VITE_AGENT_APP_ID 或 VITE_AGENT_API_KEY。'
      );
    }
    return {
      ok: true,
      data: {
        transport,
        origin,
        appId,
        apiKey,
        userId,
        timeoutMs,
        configTimeoutMs,
        credentialsExposed: true
      }
    };
  }

  return {
    ok: true,
    data: {
      transport,
      userId,
      timeoutMs,
      configTimeoutMs,
      credentialsExposed: false
    }
  };
}
