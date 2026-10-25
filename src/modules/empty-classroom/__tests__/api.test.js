import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OPTIONS_PATH,
  QUERY_PATH,
  createEmptyClassroomApi,
  createRequester,
} from '../api.js';

test('createRequester 优先使用主站 context.api.request', async () => {
  const seen = [];
  const context = {
    api: {
      async request(path, options) {
        seen.push({ path, options });
        return { ok: true, data: { campuses: ['呈贡校区'] } };
      },
    },
  };

  const request = createRequester(context);
  const result = await request('/hiagent/api/options', { method: 'GET' });

  assert.deepEqual(result, { ok: true, data: { campuses: ['呈贡校区'] } });
  assert.equal(seen[0].path, '/hiagent/api/options');
  assert.equal(seen[0].options.method, 'GET');
});

test('getOptions 请求真实路径并兼容上游 { success, data } 响应', async () => {
  const calls = [];
  const api = createEmptyClassroomApi(async (path, options) => {
    calls.push({ path, options });
    return { success: true, data: { campuses: ['呈贡校区'], max_week: 30 } };
  });

  const result = await api.getOptions();

  assert.deepEqual(result, { ok: true, data: { campuses: ['呈贡校区'], max_week: 30 } });
  assert.equal(calls[0].path, OPTIONS_PATH);
  assert.equal(calls[0].options.method, 'GET');
});

test('query 以 POST JSON 发送五个查询参数', async () => {
  const calls = [];
  const api = createEmptyClassroomApi(async (path, options) => {
    calls.push({ path, options });
    return { success: true, data: [] };
  });
  const payload = {
    campus: '呈贡校区',
    target_week: 6,
    day_of_week: 3,
    sections: [1, 2],
    building: '格物楼1栋',
  };

  const result = await api.query(payload);

  assert.equal(result.ok, true);
  assert.equal(calls[0].path, QUERY_PATH);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].options.body), payload);
});

test('兼容主站 { ok:true, data } 与 { ok:false, error } 封装', async () => {
  const okApi = createEmptyClassroomApi(async () => ({ ok: true, data: [] }));
  assert.deepEqual(await okApi.getOptions(), { ok: true, data: [] });

  const failApi = createEmptyClassroomApi(async () => ({
    ok: false,
    error: { code: 'UPSTREAM', message: '上游不可用', retryable: true },
  }));
  assert.deepEqual(await failApi.getOptions(), { ok: false, message: '上游不可用' });
});

test('上游 success=false 时保留 detail 供界面展示', async () => {
  const api = createEmptyClassroomApi(async () => ({
    success: false,
    detail: '教学周超出范围',
  }));
  assert.deepEqual(await api.query({}), { ok: false, message: '教学周超出范围' });
});

test('响应格式异常时返回明确错误', async () => {
  const api = createEmptyClassroomApi(async () => ({ foo: 'bar' }));
  assert.deepEqual(await api.getOptions(), {
    ok: false,
    message: '接口响应格式不符合预期',
  });
});

test('网络异常不抛出，转为可展示的错误信息', async () => {
  const api = createEmptyClassroomApi(async () => {
    throw new Error('Failed to fetch');
  });
  assert.deepEqual(await api.getOptions(), { ok: false, message: 'Failed to fetch' });
});

test('AbortError 标记为 aborted，控制器不会误报失败', async () => {
  const abortError = new Error('aborted');
  abortError.name = 'AbortError';
  const api = createEmptyClassroomApi(async () => {
    throw abortError;
  });

  assert.deepEqual(await api.getOptions(), {
    ok: false,
    aborted: true,
    message: '请求已取消',
  });
});
