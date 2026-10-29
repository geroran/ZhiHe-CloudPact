import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './env.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = loadEnv({ root: ROOT });

const transport = 'proxy';
const origin = String(env.AGENT_ORIGIN || 'https://agent.ynu.edu.cn').replace(/\/+$/, '');
const appId = String(env.AGENT_APP_ID || '');
const apiKey = String(env.AGENT_API_KEY || '');
const host = env.HOST || '127.0.0.1';
// 独立端口优先；仅兼容进程 PORT，忽略旧 .env.local 中的前端 PORT。
const port = Number(env.AGENT_PROXY_PORT || process.env.PORT || 8788);
const upstreamTimeoutMs = Number(env.AGENT_TIMEOUT_MS || 120000);

const ALLOWED_ENDPOINTS = new Set([
  'get_app_config_preview',
  'create_conversation',
  'chat_query_v2',
  'get_conversation_messages'
]);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function sendText(res, statusCode, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(text),
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(text);
}

function errorPayload(code, message, retryable) {
  return { ok: false, error: { code, message, retryable } };
}

function runtimeConfigScript() {
  const config = {
    transport,
    credentialsExposed: false,
    userId: env.AGENT_USER_ID || '',
    timeoutMs: Number(env.AGENT_TIMEOUT_MS || 120000),
    configTimeoutMs: Number(env.AGENT_CONFIG_TIMEOUT_MS || 15000)
  };
  const json = JSON.stringify(config).replace(/</g, '\\u003c');
  return `window.__AGENT_CONFIG__ = ${json};\n`;
}

function readBody(req, limitBytes = 1024 * 1024) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new Error('BODY_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function mapUpstreamStatus(statusCode) {
  if (statusCode === 401 || statusCode === 403) {
    return errorPayload('UNAUTHORIZED', '智能体接口鉴权失败，请检查服务端配置。', false);
  }
  if (statusCode === 404) {
    return errorPayload('NOT_FOUND', '智能体接口不存在（HTTP 404）。', false);
  }
  if (statusCode === 429) {
    return errorPayload('RATE_LIMITED', '智能体接口请求过于频繁（HTTP 429），请稍后重试。', true);
  }
  if (statusCode >= 500) {
    return errorPayload('UPSTREAM_ERROR', `智能体服务返回错误（HTTP ${statusCode}）。`, true);
  }
  return errorPayload('UPSTREAM_ERROR', `智能体服务返回异常状态（HTTP ${statusCode}）。`, false);
}

async function handleAgentProxy(req, res, endpoint) {
  if (!ALLOWED_ENDPOINTS.has(endpoint)) {
    sendJson(res, 404, errorPayload('NOT_FOUND', '该接口未纳入本地代理白名单。', false));
    return;
  }
  if (!appId || !apiKey) {
    sendJson(res, 503, errorPayload('CONFIG_ERROR', '服务端尚未配置智能体。', false));
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, errorPayload('METHOD_NOT_ALLOWED', '代理仅支持 POST。', false));
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    sendJson(res, 413, errorPayload('REQUEST_TOO_LARGE', '请求体过大。', false));
    return;
  }

  const target = `${origin}/api/proxy/api/v1/${endpoint}?appid=${encodeURIComponent(appId)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), upstreamTimeoutMs);

  let upstream;
  try {
    upstream = await fetch(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream, application/json',
        Apikey: apiKey
      },
      body,
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'error'
    });
  } catch {
    clearTimeout(timer);
    const timedOut = controller.signal.aborted;
    console.warn(`[proxy] ${endpoint} -> ${timedOut ? 'timeout' : 'unreachable'}`);
    sendJson(
      res,
      timedOut ? 504 : 502,
      timedOut
        ? errorPayload('TIMEOUT', '智能体响应超时，请稍后重试。', true)
        : errorPayload('NETWORK', '无法连接智能体服务，请确认网络或校园网环境。', true)
    );
    return;
  }

  // 超时覆盖响应体读取和整个 SSE 流。
  res.once('close', () => { clearTimeout(timer); controller.abort(); });

  if (!upstream.ok) {
    await upstream.text().catch(() => '');
    console.warn(`[proxy] ${endpoint} -> HTTP ${upstream.status}`);
    sendJson(res, upstream.status, mapUpstreamStatus(upstream.status));
    return;
  }

  // SSE 透传：不缓冲、不改写，按上游片段直接写给浏览器。
  const upstreamType = (upstream.headers.get('content-type') || '').toLowerCase();
  if (upstreamType.includes('text/event-stream') && upstream.body) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    const reader = upstream.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) res.write(Buffer.from(value));
      }
    } catch {
      console.warn(`[proxy] ${endpoint} stream aborted`);
      res.destroy();
    } finally {
      clearTimeout(timer);
      await reader.cancel().catch(() => {});
      res.end();
    }
    return;
  }

  let text;
  try {
    text = await upstream.text();
  } catch {
    sendJson(res, 502, errorPayload('BAD_RESPONSE', '读取智能体响应失败。', true));
    return;
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    sendJson(res, 502, errorPayload('BAD_RESPONSE', '智能体返回了非 JSON 内容，已停止解析。', false));
    return;
  }

  if (!data || typeof data !== 'object') {
    sendJson(res, 502, errorPayload('BAD_RESPONSE', '智能体返回结构异常。', false));
    return;
  }

  sendJson(res, 200, { ok: true, data });
}

function isAllowedStatic(pathname) {
  if (pathname === '/' || pathname === '/index.html' || pathname === '/runtime-config.js') {
    return true;
  }
  return pathname.startsWith('/src/') || pathname.startsWith('/test/');
}

async function handleStatic(req, res, pathname) {
  if (pathname === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (!isAllowedStatic(pathname)) {
    sendText(res, 404, 'Not Found');
    return;
  }

  const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = resolve(ROOT, relativePath);
  const srcRoot = resolve(ROOT, 'src') + sep;
  const testRoot = resolve(ROOT, 'test') + sep;
  if (
    filePath !== resolve(ROOT, 'index.html') &&
    !filePath.startsWith(srcRoot) &&
    !filePath.startsWith(testRoot)
  ) {
    sendText(res, 404, 'Not Found');
    return;
  }

  try {
    const content = await readFile(filePath);
    const contentType = MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': content.length,
      'Cache-Control': pathname === '/' || pathname === '/index.html' ? 'no-store' : 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(content);
  } catch {
    sendText(res, 404, 'Not Found');
  }
}

const server = http.createServer(async (req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
  } catch {
    sendText(res, 400, 'Bad Request');
    return;
  }

  if (pathname.includes('\0') || pathname.includes('\\')) {
    sendText(res, 400, 'Bad Request');
    return;
  }

  if (pathname === '/runtime-config.js') {
    const script = runtimeConfigScript();
    res.writeHead(200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Content-Length': Buffer.byteLength(script),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(script);
    return;
  }

  const proxyMatch = pathname.match(/^\/api\/agent\/([a-zA-Z0-9_]+)$/);
  if (proxyMatch) {
    await handleAgentProxy(req, res, proxyMatch[1]);
    return;
  }

  await handleStatic(req, res, pathname);
});

server.listen(port, host, () => {
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  console.log(`智启云聚本地服务：http://${host}:${actualPort}`);
  console.log(`智能体连接模式：${transport}`);
});
