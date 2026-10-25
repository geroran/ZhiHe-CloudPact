/**
 * 本地保存与导入导出。
 * 存储键带版本号；图片与 API 密钥均不写入本地存储。
 */
import { normalizeTimetable } from './model.js';

export const STORAGE_KEY = 'campus_timetable_v1';

function resolveStorage(storage) {
  if (storage) return storage;
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function loadTimetable(storage) {
  const store = resolveStorage(storage);
  if (!store) return null;
  let raw;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const result = normalizeTimetable(parsed);
    return result.ok ? result.data : null;
  } catch {
    return null;
  }
}

export function saveTimetable(timetable, storage) {
  const store = resolveStorage(storage);
  if (!store) return { ok: false, error: '当前浏览器不支持本地保存' };
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(timetable));
    return { ok: true };
  } catch {
    return { ok: false, error: '本地存储空间不足，请清理后重试' };
  }
}

export function clearTimetable(storage) {
  const store = resolveStorage(storage);
  if (!store) return;
  try {
    store.removeItem(STORAGE_KEY);
  } catch {
    // 忽略隐私模式下的存储异常。
  }
}

export function exportTimetableJson(timetable) {
  return JSON.stringify(timetable, null, 2);
}

export function importTimetableJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: '文件不是合法 JSON' };
  }
  return normalizeTimetable(parsed);
}
