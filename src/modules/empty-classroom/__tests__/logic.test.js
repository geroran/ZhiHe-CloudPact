import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyFilters,
  buildQueryPayload,
  defaultSelection,
  describeQuery,
  estimateWeek,
  groupRooms,
  isFilterActive,
  normalizeOptions,
  normalizeRooms,
  normalizeSeats,
  normalizeSections,
  weekdayNumber,
} from '../logic.js';

const rawOptions = {
  campuses: ['呈贡校区', '东陆校区'],
  buildings: ['格物楼1栋', '力行楼1栋', '文汇楼2栋', '中山邦翰楼'],
  max_week: 30,
  term: {
    XNXQMC: '2026-2027学年秋季学期',
    XQKSSJ: '20260831',
  },
};

test('normalizeOptions 只认接口真实字段', () => {
  const result = normalizeOptions(rawOptions);
  assert.equal(result.ok, true);
  assert.deepEqual(result.options, {
    campuses: ['呈贡校区', '东陆校区'],
    buildings: ['格物楼1栋', '力行楼1栋', '文汇楼2栋', '中山邦翰楼'],
    maxWeek: 30,
    termName: '2026-2027学年秋季学期',
    termStart: '20260831',
  });
});

test('normalizeOptions 在关键字段缺失时明确失败，不用默认值兜底', () => {
  assert.equal(normalizeOptions(null).ok, false);

  const noCampuses = normalizeOptions({ ...rawOptions, campuses: undefined });
  assert.equal(noCampuses.ok, false);
  assert.match(noCampuses.message, /校区列表/);

  const emptyCampuses = normalizeOptions({ ...rawOptions, campuses: [] });
  assert.equal(emptyCampuses.ok, false);
  assert.match(emptyCampuses.message, /校区列表为空/);

  const noBuildings = normalizeOptions({ ...rawOptions, buildings: undefined });
  assert.equal(noBuildings.ok, false);
  assert.match(noBuildings.message, /教学楼列表/);

  const badWeek = normalizeOptions({ ...rawOptions, max_week: 0 });
  assert.equal(badWeek.ok, false);
  assert.match(badWeek.message, /最大周次/);

  const noTerm = normalizeOptions({ ...rawOptions, term: { XQKSSJ: '20260831' } });
  assert.equal(noTerm.ok, false);
  assert.match(noTerm.message, /学期名称/);
});

test('normalizeOptions 保留空的真实教学楼列表', () => {
  const result = normalizeOptions({ ...rawOptions, buildings: [] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.options.buildings, []);
});

test('defaultSelection 按真实学期开始日期估算当前周，不写死学期', () => {
  const now = new Date(2026, 9, 25, 10, 30, 0);
  const options = normalizeOptions(rawOptions).options;
  const selection = defaultSelection(options, now);

  assert.equal(estimateWeek('20260831', now), 8);
  assert.equal(weekdayNumber(now), 7);
  assert.deepEqual(selection, {
    campus: '呈贡校区',
    week: 8,
    day: 7,
    sections: [1, 2],
    building: '',
  });
});

test('defaultSelection 在无呈贡校区时取接口返回的第一个校区，并限制在最大周次内', () => {
  const now = new Date(2027, 5, 1, 9, 0, 0);
  const options = normalizeOptions({
    ...rawOptions,
    campuses: ['东陆校区'],
    max_week: 20,
  }).options;
  const selection = defaultSelection(options, now);

  assert.equal(selection.campus, '东陆校区');
  assert.equal(selection.week, 20);
});

test('estimateWeek 在学期开始前按第 1 周处理，无效日期返回 null', () => {
  assert.equal(estimateWeek('20260831', new Date(2026, 7, 1)), 1);
  assert.equal(estimateWeek('20261399', new Date(2026, 7, 1)), null);
  assert.equal(estimateWeek('', new Date(2026, 7, 1)), null);
});

test('normalizeSections 校验 1–12、去重并排序', () => {
  assert.deepEqual(normalizeSections([2, 1, 2]), { ok: true, sections: [1, 2] });
  assert.equal(normalizeSections([]).ok, false);
  assert.equal(normalizeSections([0]).ok, false);
  assert.equal(normalizeSections([13]).ok, false);
  assert.deepEqual(normalizeSections(['1', 3]), { ok: true, sections: [1, 3] });
  assert.equal(normalizeSections('1,2').ok, false);
});

test('buildQueryPayload 生成规格要求的五个参数', () => {
  const result = buildQueryPayload(
    { campus: '呈贡校区', week: '6', day: '3', sections: [2, 1], building: '格物楼1栋' },
    30,
  );
  assert.deepEqual(result, {
    ok: true,
    payload: {
      campus: '呈贡校区',
      target_week: 6,
      day_of_week: 3,
      sections: [1, 2],
      building: '格物楼1栋',
    },
  });

  const allBuildings = buildQueryPayload(
    { campus: '呈贡校区', week: 6, day: 3, sections: [1], building: '' },
    30,
  );
  assert.equal(allBuildings.payload.building, '');
});

test('buildQueryPayload 拒绝非法条件', () => {
  const base = { campus: '呈贡校区', week: 6, day: 3, sections: [1], building: '' };

  assert.match(buildQueryPayload({ ...base, campus: '' }, 30).message, /校区/);
  assert.match(buildQueryPayload({ ...base, week: 0 }, 30).message, /教学周/);
  assert.match(buildQueryPayload({ ...base, week: 31 }, 30).message, /教学周/);
  assert.match(buildQueryPayload({ ...base, day: 8 }, 30).message, /星期/);
  assert.match(buildQueryPayload({ ...base, sections: [] }, 30).message, /至少选择一个节次/);
  assert.match(buildQueryPayload({ ...base, sections: [13] }, 30).message, /1–12/);
});

test('normalizeRooms 处理字符串座位数、未知座位与严格 borrowable', () => {
  const result = normalizeRooms([
    {
      classroom_code: 'CG20010404',
      classroom_name: '格物楼1栋1404',
      building_name: '格物楼1栋',
      seats: '90',
      borrowable: true,
    },
    {
      classroom_name: '文汇楼2栋201',
      building_name: '',
      seats: 0,
      borrowable: 'true',
    },
    {
      classroom_code: 'CG0001',
      seats: '',
      borrowable: false,
    },
  ]);

  assert.equal(result.ok, true);
  assert.deepEqual(result.rooms[0], {
    classroomName: '格物楼1栋1404',
    classroomCode: 'CG20010404',
    buildingName: '格物楼1栋',
    seats: 90,
    borrowable: true,
  });
  assert.equal(result.rooms[1].buildingName, '未标注教学楼');
  assert.equal(result.rooms[1].seats, null);
  assert.equal(result.rooms[1].borrowable, false);
  assert.equal(result.rooms[2].classroomName, 'CG0001');
  assert.equal(result.rooms[2].seats, null);
});

test('normalizeRooms 拒绝非数组 data', () => {
  assert.equal(normalizeRooms(null).ok, false);
  assert.equal(normalizeRooms({}).ok, false);
});

test('normalizeSeats 只接受正数', () => {
  assert.equal(normalizeSeats('70'), 70);
  assert.equal(normalizeSeats(0), null);
  assert.equal(normalizeSeats(''), null);
  assert.equal(normalizeSeats('abc'), null);
  assert.equal(normalizeSeats(-1), null);
});

const rooms = [
  {
    classroomName: '格物楼1栋1101',
    classroomCode: 'CG1101',
    buildingName: '格物楼1栋',
    seats: 70,
    borrowable: true,
  },
  {
    classroomName: '格物楼1栋1201',
    classroomCode: 'CG1201',
    buildingName: '格物楼1栋',
    seats: null,
    borrowable: true,
  },
  {
    classroomName: '文汇楼2栋201',
    classroomCode: 'WH0201',
    buildingName: '文汇楼2栋',
    seats: 100,
    borrowable: false,
  },
];

test('applyFilters 只在已返回结果上筛选', () => {
  assert.deepEqual(
    applyFilters(rooms, { keyword: '格物', minSeats: '', borrowableOnly: false }).map(
      (room) => room.classroomName,
    ),
    ['格物楼1栋1101', '格物楼1栋1201'],
  );

  assert.deepEqual(
    applyFilters(rooms, { keyword: '', minSeats: 80, borrowableOnly: false }).map(
      (room) => room.classroomName,
    ),
    ['文汇楼2栋201'],
  );

  assert.deepEqual(
    applyFilters(rooms, { keyword: '', minSeats: '', borrowableOnly: true }).map(
      (room) => room.classroomName,
    ),
    ['格物楼1栋1101', '格物楼1栋1201'],
  );

  assert.deepEqual(
    applyFilters(rooms, { keyword: 'WH0201', minSeats: '', borrowableOnly: false }).map(
      (room) => room.classroomName,
    ),
    ['文汇楼2栋201'],
  );
});

test('isFilterActive 判断筛选是否生效', () => {
  assert.equal(isFilterActive({ keyword: '', minSeats: '', borrowableOnly: false }), false);
  assert.equal(isFilterActive({ keyword: '  ', minSeats: '0', borrowableOnly: false }), false);
  assert.equal(isFilterActive({ keyword: '格物', minSeats: '', borrowableOnly: false }), true);
  assert.equal(isFilterActive({ keyword: '', minSeats: '60', borrowableOnly: false }), true);
  assert.equal(isFilterActive({ keyword: '', minSeats: '', borrowableOnly: true }), true);
});

test('groupRooms 优先格物楼、力行楼、文汇楼，其余按名称排序，组内按教室名排序', () => {
  const input = [
    { ...rooms[2], classroomName: '文汇楼2栋203' },
    { ...rooms[2], classroomName: '文汇楼2栋201' },
    { ...rooms[0], buildingName: '力行楼1栋', classroomName: '力行楼1栋101' },
    { ...rooms[0], buildingName: '格物楼1栋', classroomName: '格物楼1栋1102' },
    { ...rooms[0], buildingName: '格物楼1栋', classroomName: '格物楼1栋1101' },
    { ...rooms[0], buildingName: '外语楼', classroomName: '外语楼101' },
    { ...rooms[0], buildingName: '中山邦翰楼', classroomName: '中山邦翰楼101' },
  ];

  const groups = groupRooms(input);
  assert.deepEqual(
    groups.slice(0, 3).map((group) => group.name),
    ['格物楼1栋', '力行楼1栋', '文汇楼2栋'],
  );
  assert.deepEqual(
    groups[0].rooms.map((room) => room.classroomName),
    ['格物楼1栋1101', '格物楼1栋1102'],
  );
  assert.deepEqual(
    groups[2].rooms.map((room) => room.classroomName),
    ['文汇楼2栋201', '文汇楼2栋203'],
  );
  assert.equal(groups[3].name, '外语楼');
  assert.equal(groups[4].name, '中山邦翰楼');
});

test('describeQuery 使用实际查询条件', () => {
  const text = describeQuery({
    campus: '呈贡校区',
    target_week: 6,
    day_of_week: 3,
    sections: [1, 2],
    building: '格物楼1栋',
  });
  assert.equal(text, '呈贡校区 · 第 6 周 · 周三 · 第 1、2 节 · 格物楼1栋');

  const all = describeQuery({
    campus: '东陆校区',
    target_week: 2,
    day_of_week: 7,
    sections: [12],
    building: '',
  });
  assert.equal(all, '东陆校区 · 第 2 周 · 周日 · 第 12 节 · 全部教学楼');
  assert.equal(describeQuery(null), '尚未查询');
});
