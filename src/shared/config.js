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
    transport || env.VITE_AGENT_USER_ID ||
    env.VITE_AGENT_TIMEOUT_MS || env.VITE_AGENT_CONFIG_TIMEOUT_MS;
  if (!hasAnyConfig) return null;

  return {
    transport: transport || 'proxy',
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
  const raw = (win && win.__AGENT_CONFIG__) || readViteEnv() || { transport: 'proxy' };
  if (!raw || typeof raw !== 'object') {
    return configError(
      'CONFIG_MISSING',
      '运行配置无效，请检查代理配置。'
    );
  }

  const transport = !raw.transport || raw.transport === 'proxy' ? 'proxy' : null;
  if (!transport) {
    return configError('CONFIG_INVALID', '浏览器仅支持 proxy 模式，请移除旧的 direct 配置。');
  }

  const userId = typeof raw.userId === 'string' ? raw.userId.trim() : '';
  const timeoutMs = positiveNumber(raw.timeoutMs, DEFAULT_TIMEOUT_MS);
  const configTimeoutMs = positiveNumber(raw.configTimeoutMs, DEFAULT_CONFIG_TIMEOUT_MS);

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
