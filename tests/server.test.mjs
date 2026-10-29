import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { dirname, resolve } from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP_ID = 'test-appid';
const API_KEY = 'test-key';

let mockProcess = null;
let appProcess = null;
let baseUrl = '';

function getFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

function spawnNode(relativeScript, env) {
  return spawn(process.execPath, [relativeScript], {
    cwd: ROOT,
    env: { ...process.env, ...env, ...(env.PORT ? { AGENT_PROXY_PORT: env.PORT } : {}) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function waitForOutput(child, marker, timeoutMs = 8000) {
  return new Promise((resolveOutput, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      reject(new Error(`等待 ${marker} 超时`));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.includes(marker)) {
        clearTimeout(timer);
        resolveOutput(buffer);
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`子进程提前退出：${code}`));
    });
  });
}

async function waitForHttp(url, attempts = 100) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
  }
  throw new Error('本地服务未启动');
}

async function postEndpoint(endpoint, body) {
  return fetch(`${baseUrl}/api/agent/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

before(async () => {
  const mockPort = await getFreePort();
  mockProcess = spawnNode('tests/fixtures/mock-upstream.mjs', {
    MOCK_HOST: '127.0.0.1',
    MOCK_PORT: String(mockPort),
    MOCK_APP_ID: APP_ID,
    MOCK_API_KEY: API_KEY
  });
  mockProcess.stdout.resume();
  mockProcess.stderr.resume();
  await waitForOutput(mockProcess, 'MOCK_READY');

  const appPort = await getFreePort();
  appProcess = spawnNode('server/dev-server.mjs', {
    AGENT_TRANSPORT: 'direct',
    AGENT_ORIGIN: `http://127.0.0.1:${mockPort}`,
    AGENT_APP_ID: APP_ID,
    AGENT_API_KEY: API_KEY,
    AGENT_USER_ID: '',
    AGENT_TIMEOUT_MS: '200',
    HOST: '127.0.0.1',
    PORT: String(appPort)
  });
  appProcess.stdout.resume();
  appProcess.stderr.resume();

  baseUrl = `http://127.0.0.1:${appPort}`;
  await waitForHttp(`${baseUrl}/runtime-config.js`);
});

after(() => {
  if (appProcess) appProcess.kill();
  if (mockProcess) mockProcess.kill();
});

test('proxy 模式运行配置不包含凭据', async () => {
  const response = await fetch(`${baseUrl}/runtime-config.js`);
  assert.equal(response.status, 200);
  const script = await response.text();

  assert.match(script, /"transport":"proxy"/);
  assert.match(script, /"credentialsExposed":false/);
  assert.equal(script.includes(API_KEY), false);
  assert.equal(script.includes(APP_ID), false);
});

test('静态资源只开放 index 与 src，不暴露本地配置和服务端文件', async () => {
  const index = await fetch(`${baseUrl}/`);
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type') || '', /text\/html/);

  const appModule = await fetch(`${baseUrl}/src/modules/ai-assistant/index.js`);
  assert.equal(appModule.status, 200);

  const harness = await fetch(`${baseUrl}/test/ai-assistant/harness.html`);
  assert.equal(harness.status, 200);

  for (const path of ['/.env.local', '/.env.example', '/server/env.mjs', '/tests/parse.test.mjs']) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 404, `${path} 不应可访问`);
  }
});

test('代理只允许白名单接口', async () => {
  const response = await postEndpoint('delete_conversation', {
    AppConversationID: 'c',
    UserID: 'u'
  });
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error.code, 'NOT_FOUND');
});

test('代理注入凭据并返回应用配置', async () => {
  const response = await postEndpoint('get_app_config_preview', { UserID: 'u123' });
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.equal(body.ok, true);
  assert.equal(body.data.Name, '测试智能体');
  assert.equal(body.data.OpenMessage, '你好，这是测试开场白。');
  assert.deepEqual(body.data.OpenQuery, ['测试推荐问题一', '测试推荐问题二']);
});

test('代理完成创建会话与 blocking 聊天闭环', async () => {
  const created = await postEndpoint('create_conversation', { UserID: 'u123' });
  assert.equal(created.status, 200);
  const createdBody = await created.json();
  const conversationId = createdBody.data.Conversation.AppConversationID;
  assert.equal(conversationId, 'conv-test-1');

  const chat = await postEndpoint('chat_query_v2', {
    Query: '你好',
    AppConversationID: conversationId,
    ResponseMode: 'blocking',
    UserID: 'u123'
  });
  assert.equal(chat.status, 200);
  const chatBody = await chat.json();
  assert.equal(chatBody.ok, true);
  assert.equal(chatBody.data.event, 'message');
  assert.equal(chatBody.data.answer, '模拟回答：你好');
});

test('代理转发会话历史', async () => {
  const response = await postEndpoint('get_conversation_messages', {
    Limit: 100,
    AppConversationID: 'conv-test-1',
    UserID: 'u123'
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.data.Messages[0].Query, '旧问题');
});

test('上游 5xx 映射为 UPSTREAM_ERROR 且不返回上游正文', async () => {
  const response = await postEndpoint('chat_query_v2', {
    Query: 'FAIL',
    AppConversationID: 'conv-test-1',
    ResponseMode: 'blocking',
    UserID: 'u123'
  });
  assert.equal(response.status, 500);
  const body = await response.json();

  assert.equal(body.ok, false);
  assert.equal(body.error.code, 'UPSTREAM_ERROR');
  assert.equal(JSON.stringify(body).includes('upstream failure'), false);
});

test('代理透传 chat_query_v2 的 SSE 流', async () => {
  const response = await postEndpoint('chat_query_v2', {
    Query: '你好',
    AppConversationID: 'conv-test-1',
    ResponseMode: 'streaming',
    UserID: 'u123'
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /text\/event-stream/);

  const text = await response.text();
  assert.match(text, /event: message_start/);
  assert.match(text, /event: message\b/);
  assert.match(text, /"answer":"模拟回答：你好"/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('上游对 streaming 请求返回 JSON 时仍给出可解析信封', async () => {
  const response = await postEndpoint('chat_query_v2', {
    Query: 'NOSSE',
    AppConversationID: 'conv-test-1',
    ResponseMode: 'streaming',
    UserID: 'u123'
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /application\/json/);

  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.data.answer, '模拟回答：NOSSE');
});

// 旧服务端模式值不应重新开放凭据下发。
test('上游鉴权失败不返回含凭据的错误正文', async () => {
  const response = await postEndpoint('chat_query_v2', { Query: 'AUTH_FAIL' });
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error.code, 'UNAUTHORIZED');
  assert.equal(JSON.stringify(body).includes(API_KEY), false);
});

test('上游超时返回可重试错误', async () => {
  const response = await postEndpoint('chat_query_v2', { Query: 'TIMEOUT' });
  assert.equal(response.status, 504);
  assert.equal((await response.json()).error.code, 'TIMEOUT');
});

test('上游流中断使客户端读取失败而非正常完成', async () => {
  const response = await postEndpoint('chat_query_v2', { Query: 'BROKEN_STREAM' });
  await assert.rejects(response.text());
});

test('未配置服务端凭据时返回 CONFIG_ERROR', async () => {
  const port = await getFreePort();
  const child = spawnNode('server/dev-server.mjs', {
    AGENT_APP_ID: '', AGENT_API_KEY: '', PORT: String(port), HOST: '127.0.0.1'
  });
  child.stdout.resume();
  child.stderr.resume();
  try {
    await waitForHttp(`http://127.0.0.1:${port}/runtime-config.js`);
    const response = await fetch(`http://127.0.0.1:${port}/api/agent/create_conversation`, { method: 'POST', body: '{}' });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'CONFIG_ERROR');
  } finally { child.kill(); }
});
