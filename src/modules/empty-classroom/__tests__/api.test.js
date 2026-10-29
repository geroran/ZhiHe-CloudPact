import test from 'node:test';
import assert from 'node:assert/strict';
import { createSameOriginClient } from '../../../shared/api.js';

import {
  OPTIONS_PATH,
  QUERY_PATH,
  createEmptyClassroomApi,
  createRequester,
} from '../api.js';

test('主站同源客户端接入空教室真实信封，完成选项与查询请求', async (t) => {
  const calls = [];
  const options = { campuses: ['呈贡校区'], max_week: 30 };
  const rooms = [{ classroom_name: '格物楼101', seats: 80 }];
  t.mock.method(globalThis, 'fetch', async (path, init) => {
    calls.push({ path, init });
    return new Response(JSON.stringify({ success: true, data: path === OPTIONS_PATH ? options : rooms }), {
      headers: { 'Content-Type': 'application/json' },
    });
  });
  const api = createEmptyClassroomApi(createRequester({ api: createSameOriginClient('') }));
  assert.deepEqual(await api.getOptions(), { ok: true, data: options });
  const payload = { campus: '呈贡校区', target_week: 8, day_of_week: 7, sections: [1, 2], building: '' };
  assert.deepEqual(await api.query(payload), { ok: true, data: rooms });
  assert.equal(calls[0].path, OPTIONS_PATH);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[1].path, QUERY_PATH);
  assert.equal(calls[1].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[1].init.body), payload);
});

test('主站接入时保留上游业务错误，HTTP 失败不能被 success=true 误判为成功', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch');
  const api = createEmptyClassroomApi(createRequester({ api: createSameOriginClient('') }));
  fetchMock.mock.mockImplementation(async () => new Response(JSON.stringify({ success: false, detail: '教学周超出范围' })));
  assert.deepEqual(await api.query({}), { ok: false, message: '教学周超出范围' });
  fetchMock.mock.mockImplementation(async () => new Response(JSON.stringify({ success: true, message: '上游暂不可用' }), { status: 502 }));
  assert.deepEqual(await api.getOptions(), { ok: false, message: '上游暂不可用' });
});

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
