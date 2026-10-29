import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

// 实际经过 Vite 验证路由归属，避免仅比较配置文本。
test('开发网关将各业务请求送至对应后端', async () => {
  const upstreams = [];
  const oldEnv = { ...process.env };
  let vite;
  try {
    for (const name of ['api', 'agent', 'courses', 'dream']) {
      const server = http.createServer((req, res) => {
        if (name === 'dream') res.setHeader('Set-Cookie', 'dm_session=test; HttpOnly; Path=/');
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ service: name, path: req.url }));
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      upstreams.push(server);
    }
    const targets = upstreams.map(server => `http://127.0.0.1:${server.address().port}`);
    Object.assign(process.env, {
      TERM_COURSES_TARGET: targets[0], AGENT_PROXY_TARGET: targets[1],
      COURSE_API_TARGET: targets[2], DREAM_MONITOR_TARGET: targets[3],
      VITE_AGENT_TRANSPORT: 'proxy', VITE_AGENT_APP_ID: '', VITE_AGENT_API_KEY: ''
    });
    vite = await createServer({ server: { port: 0, open: false } });
    await vite.listen();
    const base = `http://127.0.0.1:${vite.httpServer.address().port}`;
    const routes = {
      '/api/health': 'api', '/api/config': 'api', '/api/chat': 'api',
      '/api/term-courses': 'api', '/api/course-grades/search': 'api',
      '/api/market/posts': 'api', '/api/market/hot': 'api', '/api/market/search': 'api',
      '/api/charging/ports': 'api', '/api/schedule/recognize': 'api',
      '/api/agent/chat_query_v2': 'agent', '/api/courses': 'courses',
      '/api/me': 'dream', '/api/login': 'dream', '/api/logout': 'dream',
      '/api/state': 'dream', '/api/refresh': 'dream', '/api/activity': 'dream'
    };
    for (const [path, expected] of Object.entries(routes)) {
      const response = await fetch(base + path);
      assert.deepEqual(await response.json(), { service: expected, path });
      if (expected === 'dream') assert.match(response.headers.get('set-cookie'), /HttpOnly/);
    }
    // 后端退出时，网关应给出明确错误，而非 Vite 默认的空白 500。
    upstreams[1].closeAllConnections();
    await new Promise(resolve => upstreams[1].close(resolve));
    const unavailable = await fetch(base + '/api/agent/get_app_config_preview', { method: 'POST' });
    assert.equal(unavailable.status, 502);
    assert.equal((await unavailable.json()).error.code, 'AGENT_PROXY_UNAVAILABLE');
    const nginx = await readFile(new URL('../deploy/nginx.locations.conf', import.meta.url), 'utf8');
    for (const port of [8011, 8788, 8787, 8770]) assert.ok(nginx.includes(`127.0.0.1:${port}`));
    assert.match(nginx, /proxy_buffering off/);
  } finally {
    if (vite) await vite.close();
    await Promise.all(upstreams.map(server => new Promise(resolve => server.close(resolve))));
    for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key];
    Object.assign(process.env, oldEnv);
  }
});
