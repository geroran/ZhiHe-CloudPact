/**
 * dreamspace-events API 适配器单元测试。
 * 用可控的 fetch 替身模拟真实 dream-monitor 响应，不访问网络。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createDreamApi, rawRequest, assertNoUpstreamToken, DreamApiError } from '../src/modules/dreamspace-events/api.js';

const realFetch = globalThis.fetch;

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (payload === undefined ? '' : JSON.stringify(payload)),
  };
}

function installFetch(handler) {
  const calls = [];
  globalThis.fetch = async (path, init) => {
    calls.push({ path, init });
    return handler(path, init, calls);
  };
  return calls;
}

function restoreFetch() {
  globalThis.fetch = realFetch;
}

test.afterEach(() => restoreFetch());

test('未登录时 /api/me 返回 401 且 needLogin 可识别', async () => {
  installFetch(() => jsonResponse(401, { error: '未登录', need_login: true }));
  const api = createDreamApi();
  await assert.rejects(
    () => api.me(),
    (error) => {
      assert.ok(error instanceof DreamApiError);
      assert.equal(error.status, 401);
      assert.equal(error.needLogin, true);
      return true;
    }
  );
});

test('账号密码错误时保留后端错误信息且不可重试', async () => {
  installFetch(() => jsonResponse(400, { ok: false, error: '密码不对' }));
  const api = createDreamApi();
  await assert.rejects(
    () => api.login('demo-account', 'wrong-password'),
    (error) => {
      assert.equal(error.message, '密码不对');
      assert.equal(error.retryable, false);
      assert.equal(error.needLogin, false);
      return true;
    }
  );
});

test('登录请求使用同源 POST 且不发送 force', async () => {
  const calls = installFetch(() => jsonResponse(200, { ok: true, uid: '1' }));
  const api = createDreamApi();
  await api.login(' demo-account ', 'demo-password');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/login');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    account: 'demo-account',
    password: 'demo-password',
  });
});

test('缺少账号或密码时本地拒绝，不发起请求', async () => {
  const calls = installFetch(() => jsonResponse(200, {}));
  const api = createDreamApi();
  // 这两个校验在发请求前同步抛出，不会走到 fetch。
  assert.throws(() => api.login('', 'x'), /请输入到梦空间账号和密码/);
  assert.throws(() => api.login('demo-account', ''), /请输入到梦空间账号和密码/);
  assert.equal(calls.length, 0);
});

test('后端未启动（fetch 抛错）时归类为 not_connected', async () => {
  installFetch(() => {
    throw new TypeError('Failed to fetch');
  });
  const api = createDreamApi();
  await assert.rejects(
    () => api.me(),
    (error) => {
      assert.equal(error.code, 'not_connected');
      assert.equal(error.retryable, true);
      return true;
    }
  );
});

test('同源路径返回 HTML（服务未部署）时归类为 not_connected', async () => {
  installFetch(() => ({ ok: true, status: 200, text: async () => '<!doctype html><html></html>' }));
  const api = createDreamApi();
  await assert.rejects(() => api.state(), (error) => error.code === 'not_connected');
});

test('请求超时给出 timeout 错误而不是一直等待', async () => {
  installFetch(
    (_path, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      })
  );
  await assert.rejects(
    () => rawRequest('/api/me', { timeoutMs: 30 }),
    (error) => {
      assert.ok(error instanceof DreamApiError);
      assert.equal(error.code, 'timeout');
      return true;
    }
  );
});

test('外部取消（切换模块）保持 AbortError，不误报超时', async () => {
  installFetch(
    (_path, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      })
  );
  const controller = new AbortController();
  const pending = rawRequest('/api/state', { signal: controller.signal, timeoutMs: 5000 });
  controller.abort();
  await assert.rejects(pending, (error) => error.name === 'AbortError');
});

test('会话过期（/api/state 401）返回 needLogin', async () => {
  installFetch(() => jsonResponse(401, { error: '未登录', need_login: true }));
  const api = createDreamApi();
  await assert.rejects(
    () => api.state(),
    (error) => {
      assert.equal(error.needLogin, true);
      assert.equal(error.code, 'http_401');
      return true;
    }
  );
});

test('正常列表原样返回，空列表也能读取', async () => {
  const snapshot = {
    busy: false,
    last_sync: 1792600000,
    stats: { total: 1, live: 1, open: 1 },
    items: [{ aid: '1', name: '示例活动', state: 'open', quota: 3 }],
  };
  installFetch(() => jsonResponse(200, snapshot));
  const api = createDreamApi();
  assert.deepEqual(await api.state(), snapshot);

  const empty = { busy: false, last_sync: 1792600001, stats: { total: 0, live: 0 }, items: [] };
  installFetch(() => jsonResponse(200, empty));
  assert.deepEqual(await api.state(), empty);
});

test('后端仍返回顶层 token（含空值）时拒绝读取', async () => {
  for (const token of ['UPSTREAM_SECRET', '', null]) {
    installFetch(() => jsonResponse(200, { busy: false, items: [], token }));
    const api = createDreamApi();
    await assert.rejects(
      () => api.state(),
      (error) => {
        assert.equal(error.code, 'backend_token_leak');
        assert.equal(error.retryable, false);
        return true;
      }
    );
  }
  assert.throws(() => assertNoUpstreamToken({ items: [], token: '' }), /仍返回上游 token/);
});

test('详情成功返回顶层白名单对象，失败转为可重试错误', async () => {
  installFetch((path) => {
    if (path === '/api/activity?aid=123') {
      return jsonResponse(200, { activityId: '123', activityName: '示例活动', signUpId: '0' });
    }
    return jsonResponse(500, { error: '上游请求失败' });
  });
  const api = createDreamApi();
  const detail = await api.activity('123');
  assert.equal(detail.activityName, '示例活动');

  await assert.rejects(
    () => api.activity('999'),
    (error) => {
      assert.equal(error.status, 500);
      assert.equal(error.retryable, true);
      assert.equal(error.message, '上游请求失败');
      return true;
    }
  );
  assert.throws(() => api.activity(''), /缺少活动 ID/);
});

test('刷新接口只提交空 JSON，并返回 started', async () => {
  const calls = installFetch(() => jsonResponse(200, { ok: true, started: true }));
  const api = createDreamApi();
  assert.deepEqual(await api.refresh(), { ok: true, started: true });
  assert.equal(calls[0].path, '/api/refresh');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.body, '{}');
});

test('模块只暴露只读接口，不存在报名/取消报名调用', async () => {
  const calls = installFetch(() => jsonResponse(200, { ok: true }));
  const api = createDreamApi();
  assert.equal(api.signup, undefined);
  assert.equal(api.cancel, undefined);
  assert.equal(api.signupCancel, undefined);

  await api.me();
  await api.logout();
  await api.state();
  await api.refresh();
  await api.activity('1');
  const used = new Set(calls.map((call) => call.path));
  for (const path of used) {
    assert.ok(
      ['/api/me', '/api/logout', '/api/state', '/api/refresh', '/api/activity?aid=1'].includes(path),
      `出现未预期的接口调用：${path}`
    );
  }
  assert.ok(![...used].some((path) => path.includes('signup') || path.includes('cancel')));
});
