import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Minimal .env loader. Existing process.env values win, and values are never
 * logged. Only server-side variables are read here.
 */
export function loadEnvFiles(cwd = process.cwd(), filenames = [".env.local", ".env"]) {
  for (const name of filenames) {
    const path = resolve(cwd, name);
    if (!existsSync(path)) continue;
    let raw;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      continue;
    }

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      if (process.env[key] !== undefined) continue;

      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith("'") && value.endsWith("'")) ||
        (value.startsWith('"') && value.endsWith('"'))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}
