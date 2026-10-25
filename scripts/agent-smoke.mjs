import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../server/env.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = loadEnv({ root: ROOT });

const origin = String(env.AGENT_ORIGIN || '').replace(/\/+$/, '');
const appId = String(env.AGENT_APP_ID || '');
const apiKey = String(env.AGENT_API_KEY || '');
const configuredUserId = String(env.AGENT_USER_ID || '').trim();
const userId = configuredUserId || `smoke-${randomBytes(4).toString('hex')}`;
const smokeOrigin = 'http://127.0.0.1:5173';

if (!origin || !appId || !apiKey) {
  console.error('缺少 AGENT_ORIGIN / AGENT_APP_ID / AGENT_API_KEY，请先在 .env.local 中配置。');
  process.exit(1);
}
if (userId.length > 20 || /\s/.test(userId)) {
  console.error('AGENT_USER_ID 无效：长度需为 1-20 且不含空白字符。');
  process.exit(1);
}

const apiBase = `${origin}/api/proxy/api/v1`;
let failed = 0;

function markFailure(message) {
  failed += 1;
  console.log(`失败：${message}`);
}

async function checkCors() {
  const url = `${apiBase}/chat_query_v2?appid=${encodeURIComponent(appId)}`;
  try {
    const response = await fetch(url, {
      method: 'OPTIONS',
      headers: {
        Origin: smokeOrigin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'apikey, content-type'
      },
      signal: AbortSignal.timeout(20000)
    });
    const allowOrigin = response.headers.get('access-control-allow-origin');
    const allowHeaders = response.headers.get('access-control-allow-headers');
    console.log(`[1/4] CORS 预检：HTTP ${response.status}`);
    console.log(`      Access-Control-Allow-Origin：${allowOrigin || '未返回'}`);
    console.log(`      Access-Control-Allow-Headers：${allowHeaders || '未返回'}`);
    if (!allowOrigin) {
      markFailure('预检未返回 Access-Control-Allow-Origin，浏览器直连可能被 CORS 拒绝。');
    }
  } catch (error) {
    const reason = error && error.name === 'TimeoutError' ? '超时' : String(error && error.message);
    markFailure(`CORS 预检请求未完成（${reason}）。`);
  }
}

async function call(endpoint, body, label, timeoutMs = 120000) {
  const url = `${apiBase}/${endpoint}?appid=${encodeURIComponent(appId)}`;
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Apikey: apiKey
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const text = await response.text();
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    console.log(`[${label}] HTTP ${response.status} | ${elapsed}s | ${json ? 'JSON' : '非 JSON'}`);
    if (!response.ok) {
      markFailure(`${label} 返回 HTTP ${response.status}。`);
      return null;
    }
    if (!json) {
      markFailure(`${label} 返回内容不是 JSON（blocking JSON 预期被破坏）。`);
      return null;
    }
    return json;
  } catch (error) {
    const reason = error && error.name === 'TimeoutError' ? '超时' : String(error && error.message);
    markFailure(`${label} 请求未完成（${reason}）。`);
    return null;
  }
}

console.log(`智能体接口 smoke 检查：${origin}`);
console.log(`UserID：${configuredUserId ? '使用配置值' : '为本轮临时随机生成'}（长度 ${userId.length}）`);

await checkCors();

const config = await call(
  'get_app_config_preview',
  { UserID: userId },
  '2/4 应用配置'
);
if (config) {
  const name = typeof config.Name === 'string' ? config.Name : '';
  const openMessage = typeof config.OpenMessage === 'string' ? config.OpenMessage : '';
  const openQueries = Array.isArray(config.OpenQuery) ? config.OpenQuery.length : 0;
  console.log(`      名称：${name || '未返回'}`);
  console.log(`      开场白：${openMessage ? `已返回（${openMessage.length} 字）` : '未返回'}`);
  console.log(`      推荐问题：${openQueries} 条`);
}

const created = await call('create_conversation', { UserID: userId }, '3/4 创建会话');
const conversationId =
  created && created.Conversation && typeof created.Conversation.AppConversationID === 'string'
    ? created.Conversation.AppConversationID
    : '';
if (created && !conversationId) {
  markFailure('创建会话成功但缺少 AppConversationID。');
}

if (conversationId) {
  console.log(`      已获取 AppConversationID（长度 ${conversationId.length}）。`);
  const chat = await call(
    'chat_query_v2',
    {
      Query: '你好，请用一句话介绍你能做什么。',
      AppConversationID: conversationId,
      ResponseMode: 'blocking',
      UserID: userId
    },
    '4/4 blocking 聊天'
  );
  if (chat) {
    const answer = typeof chat.answer === 'string' ? chat.answer : '';
    console.log(`      event：${typeof chat.event === 'string' ? chat.event : '未返回'}`);
    console.log(`      answer：${answer ? `${answer.length} 字，前 80 字：${answer.replace(/\s+/g, ' ').slice(0, 80)}` : '未返回'}`);
    if (!answer) markFailure('blocking 聊天响应缺少 answer 字段。');
  }
} else {
  markFailure('未获得会话 ID，跳过聊天检查。');
}

if (failed > 0) {
  console.log(
    `\n结果：${failed} 项未通过。请记录具体 HTTP 状态与网络环境后再决定是否在 .env.local 中切换 VITE_AGENT_TRANSPORT=proxy。`
  );
  process.exitCode = 1;
} else {
  console.log('\n结果：全部通过（仅验证 blocking JSON，未验证 SSE）。');
}
