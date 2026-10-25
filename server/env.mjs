import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ENV_FILES = ['.env', '.env.local'];
const OVERRIDABLE_KEYS = new Set(['HOST', 'PORT']);

/**
 * 读取本地配置。文件值先合并，随后进程环境变量覆盖（便于测试）。
 * 只返回配置对象，不打印任何值。
 */
export function loadEnv({ root = process.cwd(), env = process.env } = {}) {
  const values = {};
  for (const file of ENV_FILES) {
    const filePath = path.join(root, file);
    if (!existsSync(filePath)) continue;
    Object.assign(values, parseEnvFile(readFileSync(filePath, 'utf8')));
  }
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith('AGENT_') || OVERRIDABLE_KEYS.has(key)) {
      if (typeof value === 'string') values[key] = value;
    }
  }
  return values;
}

export function parseEnvFile(text) {
  const values = {};
  for (const rawLine of String(text).replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim().replace(/^export\s+/, '');
    if (!key) continue;
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}
