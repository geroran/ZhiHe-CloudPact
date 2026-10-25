import test from 'node:test';
import assert from 'node:assert/strict';

import { createEmptyClassroomController } from '../controller.js';

const rawOptions = {
  campuses: ['呈贡校区', '东陆校区'],
  buildings: ['格物楼1栋', '文汇楼2栋', '中山邦翰楼'],
  max_week: 30,
  term: {
    XNXQMC: '2026-2027学年秋季学期',
    XQKSSJ: '20260831',
  },
};

const rawRooms = [
  {
    classroom_code: 'CG1101',
    classroom_name: '格物楼1栋1101',
    building_name: '格物楼1栋',
    seats: '70',
    borrowable: true,
  },
  {
    classroom_code: 'CG1201',
    classroom_name: '格物楼1栋1201',
    building_name: '格物楼1栋',
    seats: '100',
    borrowable: false,
  },
  {
    classroom_code: 'WH0201',
    classroom_name: '文汇楼2栋201',
    building_name: '文汇楼2栋',
    seats: '90',
    borrowable: true,
  },
  {
    classroom_code: 'ZS0101',
    classroom_name: '中山邦翰楼101',
    building_name: '中山邦翰楼',
    seats: '',
    borrowable: 'true',
  },
];

function createApi({ optionsResult = { ok: true, data: rawOptions }, queryResult = { ok: true, data: rawRooms } } = {}) {
  const calls = { options: 0, query: 0, payloads: [], signals: [] };
  return {
    calls,
    async getOptions({ signal } = {}) {
      calls.options += 1;
      calls.optionsSignal = signal;
      return typeof optionsResult === 'function' ? optionsResult() : optionsResult;
    },
    async query(payload, { signal } = {}) {
      calls.query += 1;
      calls.payloads.push(payload);
      calls.signals.push(signal);
      return typeof queryResult === 'function' ? queryResult(payload) : queryResult;
    },
  };
}

const fixedNow = () => new Date(2026, 9, 25, 10, 0, 0);

test('选项接口成功后使用真实学期与默认条件', async () => {
  const api = createApi();
  const controller = createEmptyClassroomController({ api, now: fixedNow });

  await controller.loadOptions();
  const state = controller.getState();

  assert.equal(state.optionsStatus, 'ready');
  assert.equal(state.options.termName, '2026-2027学年秋季学期');
  assert.deepEqual(state.selection, {
    campus: '呈贡校区',
    week: 8,
    day: 7,
    sections: [1, 2],
    building: '',
  });
  assert.equal(controller.canQuery(), true);
});

test('选项接口失败时明确报错、清空选项且禁止查询', async () => {
  const api = createApi({ optionsResult: { ok: false, message: '连接超时' } });
  const controller = createEmptyClassroomController({ api, now: fixedNow });

  await controller.loadOptions();
  let state = controller.getState();

  assert.equal(state.optionsStatus, 'error');
  assert.equal(state.optionsError, '连接超时');
  assert.equal(state.options, null);
  assert.equal(controller.canQuery(), false);

  await controller.query();
  state = controller.getState();
  assert.equal(state.queryValidationError, '选项接口失败，无法查询');
  assert.equal(api.calls.query, 0);
});

test('选项接口失败后可重试并恢复真实选项', async () => {
  let mode = 'fail';
  const api = {
    calls: { options: 0, query: 0 },
    async getOptions() {
      this.calls.options += 1;
      return mode === 'fail' ? { ok: false, message: '暂时不可用' } : { ok: true, data: rawOptions };
    },
    async query() {
      this.calls.query += 1;
      return { ok: true, data: [] };
    },
  };
  const controller = createEmptyClassroomController({ api, now: fixedNow });

  await controller.loadOptions();
  assert.equal(controller.getState().optionsStatus, 'error');

  mode = 'ok';
  await controller.loadOptions();
  assert.equal(controller.getState().optionsStatus, 'ready');
  assert.equal(controller.canQuery(), true);
  assert.equal(api.calls.options, 2);
});

test('查询发送规格参数并按真实结果分组', async () => {
  const api = createApi();
  const controller = createEmptyClassroomController({ api, now: fixedNow });
  await controller.loadOptions();

  controller.updateSelection({ week: 6, day: 3, sections: [2, 1], building: '格物楼1栋' });
  await controller.query();

  const state = controller.getState();
  assert.equal(state.queryStatus, 'success');
  assert.equal(state.returnedCount, 4);
  assert.deepEqual(api.calls.payloads[0], {
    campus: '呈贡校区',
    target_week: 6,
    day_of_week: 3,
    sections: [1, 2],
    building: '格物楼1栋',
  });
  assert.deepEqual(controller.getGroups().map((group) => group.name), [
    '格物楼1栋',
    '文汇楼2栋',
    '中山邦翰楼',
  ]);
  assert.equal(state.results[0].seats, 70);
  assert.equal(state.results[3].borrowable, false);
});

test('没有选择节次时阻止请求并提示', async () => {
  const api = createApi();
  const controller = createEmptyClassroomController({ api, now: fixedNow });
  await controller.loadOptions();

  controller.toggleSection(1);
  controller.toggleSection(2);
  await controller.query();

  const state = controller.getState();
  assert.equal(state.queryValidationError, '请至少选择一个节次');
  assert.equal(api.calls.query, 0);
  assert.equal(state.queryStatus, 'idle');
});

test('筛选只在已返回结果上执行，不额外请求', async () => {
  const api = createApi();
  const controller = createEmptyClassroomController({ api, now: fixedNow });
  await controller.loadOptions();
  await controller.query();
  assert.equal(api.calls.query, 1);

  controller.setFilters({ keyword: '格物' });
  controller.setFilters({ minSeats: '80' });
  controller.setFilters({ borrowableOnly: true });

  assert.equal(api.calls.query, 1);
  assert.deepEqual(controller.getCounts(), { total: 4, visible: 0 });

  controller.resetFilters();
  assert.deepEqual(controller.getCounts(), { total: 4, visible: 4 });
  assert.equal(api.calls.query, 1);
});

test('borrowable 只有严格等于 true 才保留', async () => {
  const api = createApi();
  const controller = createEmptyClassroomController({ api, now: fixedNow });
  await controller.loadOptions();
  await controller.query();

  controller.setFilters({ borrowableOnly: true });
  const names = controller.getVisibleRooms().map((room) => room.classroomName);

  assert.deepEqual(names, ['格物楼1栋1101', '文汇楼2栋201']);
});

test('查询失败时保留查询条件并展示上游错误', async () => {
  const api = createApi({ queryResult: { ok: false, message: '上游 500' } });
  const controller = createEmptyClassroomController({ api, now: fixedNow });
  await controller.loadOptions();
  controller.updateSelection({ week: 6 });
  await controller.query();

  const state = controller.getState();
  assert.equal(state.queryStatus, 'error');
  assert.equal(state.queryError, '上游 500');
  assert.equal(state.results.length, 0);
  assert.equal(state.selection.week, 6);
  assert.equal(state.lastQuery.target_week, 6);
});

test('查询返回格式异常时展示明确错误', async () => {
  const api = createApi({ queryResult: { ok: true, data: { rooms: [] } } });
  const controller = createEmptyClassroomController({ api, now: fixedNow });
  await controller.loadOptions();
  await controller.query();

  const state = controller.getState();
  assert.equal(state.queryStatus, 'error');
  assert.equal(state.queryError, '查询接口返回的 data 不是数组');
});

test('新查询会重置筛选条件', async () => {
  const api = createApi();
  const controller = createEmptyClassroomController({ api, now: fixedNow });
  await controller.loadOptions();
  await controller.query();
  controller.setFilters({ keyword: '格物' });

  await controller.query();
  assert.deepEqual(controller.getState().filters, {
    keyword: '',
    minSeats: '',
    borrowableOnly: false,
  });
});

test('较早的查询响应不会覆盖较新的查询结果', async () => {
  const resolvers = [];
  const api = {
    async getOptions() {
      return { ok: true, data: rawOptions };
    },
    query() {
      return new Promise((resolve) => resolvers.push(resolve));
    },
  };
  const controller = createEmptyClassroomController({ api, now: fixedNow });
  await controller.loadOptions();

  const first = controller.query();
  controller.updateSelection({ week: 9 });
  const second = controller.query();

  resolvers[1]({ ok: true, data: [{ classroom_name: '新结果', building_name: '格物楼1栋' }] });
  await second;

  resolvers[0]({ ok: true, data: [{ classroom_name: '旧结果', building_name: '文汇楼2栋' }] });
  await first;

  const state = controller.getState();
  assert.equal(state.returnedCount, 1);
  assert.equal(state.results[0].classroomName, '新结果');
  assert.equal(state.lastQuery.target_week, 9);
});

test('重新加载选项会中止在途查询，旧结果不会覆盖', async () => {
  let resolveQuery = null;
  let querySignal = null;
  const api = {
    async getOptions() {
      return { ok: true, data: rawOptions };
    },
    query(payload, { signal } = {}) {
      querySignal = signal;
      return new Promise((resolve) => {
        resolveQuery = resolve;
      });
    },
  };
  const controller = createEmptyClassroomController({ api, now: fixedNow });
  await controller.loadOptions();

  const pending = controller.query();
  assert.equal(querySignal.aborted, false);

  await controller.loadOptions();
  assert.equal(querySignal.aborted, true);

  resolveQuery({ ok: true, data: rawRooms });
  await pending;

  const state = controller.getState();
  assert.equal(state.queryStatus, 'idle');
  assert.equal(state.results.length, 0);
});

test('destroy 会中止在途选项请求并清空订阅', () => {
  let capturedSignal = null;
  const api = {
    getOptions({ signal } = {}) {
      capturedSignal = signal;
      return new Promise(() => {});
    },
    async query() {
      return { ok: true, data: [] };
    },
  };
  const controller = createEmptyClassroomController({ api, now: fixedNow });

  controller.loadOptions();
  assert.equal(capturedSignal.aborted, false);
  controller.destroy();
  assert.equal(capturedSignal.aborted, true);
});
