export const USER_ID_MAX_LENGTH = 20;
const STORAGE_KEY = 'zyq.ai-assistant.user-id.v1';

function userIdError(message) {
  return { ok: false, error: { code: 'USER_ID_INVALID', message, retryable: false } };
}

/** 接口文档约定 UserID 长度 1-20，且应用内唯一。 */
export function isValidUserId(value) {
  if (typeof value !== 'string') return false;
  if (value.length < 1 || value.length > USER_ID_MAX_LENGTH) return false;
  return !/\s/.test(value);
}

export function generateUserId(cryptoImpl = globalThis.crypto) {
  let suffix = '';
  if (cryptoImpl && typeof cryptoImpl.getRandomValues === 'function') {
    const bytes = new Uint8Array(6);
    cryptoImpl.getRandomValues(bytes);
    suffix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  } else {
    suffix = Math.random().toString(16).slice(2, 14).padEnd(12, '0');
  }
  return `u${suffix}`.slice(0, USER_ID_MAX_LENGTH);
}

/**
 * 解析 UserID：优先使用显式配置；否则为每个浏览器生成随机 ID 并持久化，
 * 避免把所有访客隐式映射为同一个共享账号。
 */
export function resolveUserId({ configured = '', storage = null, cryptoImpl = globalThis.crypto } = {}) {
  const trimmed = typeof configured === 'string' ? configured.trim() : '';
  if (trimmed) {
    if (!isValidUserId(trimmed)) {
      return userIdError('配置的 AGENT_USER_ID 无效：长度必须为 1-20 且不含空白字符。');
    }
    return { ok: true, data: { userId: trimmed, source: 'configured' } };
  }

  let stored = null;
  if (storage) {
    try {
      stored = storage.getItem(STORAGE_KEY);
    } catch {
      stored = null;
    }
    if (isValidUserId(stored)) {
      return { ok: true, data: { userId: stored, source: 'storage' } };
    }
  }

  const generated = generateUserId(cryptoImpl);
  if (storage) {
    try {
      storage.setItem(STORAGE_KEY, generated);
    } catch {
      // 存储不可用时退化为当前页面的临时身份。
    }
  }
  return { ok: true, data: { userId: generated, source: 'generated' } };
}
