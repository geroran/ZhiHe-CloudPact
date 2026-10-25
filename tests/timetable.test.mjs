import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTimetable,
  formatWeekRules,
  normalizeCourse,
  normalizeTimetable
} from '../src/modules/timetable/model.js';
import {
  computeCurrentWeek,
  courseMatchesWeek,
  coursesForWeek,
  detectConflicts,
  isMonday,
  ruleMatchesWeek
} from '../src/modules/timetable/rules.js';
import { recognizeSchedule } from '../src/modules/timetable/api.js';

const rule = (from, to, parity = 'all') => ({ from, to, parity });

const course = (overrides = {}) => ({
  id: overrides.id || 'c1',
  courseName: overrides.courseName || '高等数学',
  teacher: '',
  classroom: '',
  weekday: 1,
  startSection: 1,
  endSection: 2,
  weekRules: [rule(1, 18)],
  needsReview: [],
  ...overrides
});

test('周次规则：全周、单周、双周与闭区间边界', () => {
  assert.equal(ruleMatchesWeek(rule(1, 18), 1), true);
  assert.equal(ruleMatchesWeek(rule(1, 18), 18), true);
  assert.equal(ruleMatchesWeek(rule(1, 18), 19), false);
  assert.equal(ruleMatchesWeek(rule(1, 18, 'odd'), 1), true);
  assert.equal(ruleMatchesWeek(rule(1, 18, 'odd'), 2), false);
  assert.equal(ruleMatchesWeek(rule(1, 18, 'odd'), 17), true);
  assert.equal(ruleMatchesWeek(rule(2, 18, 'even'), 2), true);
  assert.equal(ruleMatchesWeek(rule(2, 18, 'even'), 3), false);
  assert.equal(ruleMatchesWeek(rule(10, 18, 'even'), 8), false);
});

test('多段周次规则：任一规则匹配即开课', () => {
  const item = course({
    weekRules: [rule(1, 8), rule(10, 18, 'even')]
  });
  assert.equal(courseMatchesWeek(item, 5), true);
  assert.equal(courseMatchesWeek(item, 9), false);
  assert.equal(courseMatchesWeek(item, 10), true);
  assert.equal(courseMatchesWeek(item, 11), false);
  assert.equal(courseMatchesWeek(course({ weekRules: [] }), 3), false);
});

test('按周筛选并按星期、节次排序', () => {
  const courses = [
    course({ id: 'b', weekday: 3, startSection: 1 }),
    course({ id: 'a', weekday: 1, startSection: 3 }),
    course({ id: 'c', weekday: 1, startSection: 1, weekRules: [rule(2, 18, 'even')] })
  ];
  assert.deepEqual(
    coursesForWeek(courses, 1).map((item) => item.id),
    ['a', 'b']
  );
  assert.deepEqual(
    coursesForWeek(courses, 2).map((item) => item.id),
    ['c', 'a', 'b']
  );
});

test('当前周计算：未设置、未开始、进行中、已结束', () => {
  const today = new Date(2026, 9, 25); // 2026-10-25 周日

  assert.equal(computeCurrentWeek('', 18, today).status, 'unset');
  assert.equal(computeCurrentWeek('2026-11-02', 18, today).status, 'not-started');

  const mid = computeCurrentWeek('2026-09-07', 18, today);
  assert.equal(mid.status, 'ok');
  assert.equal(mid.week, 7);

  const ended = computeCurrentWeek('2026-01-05', 18, today);
  assert.equal(ended.status, 'ended');
  assert.equal(ended.week, 18);

  assert.equal(computeCurrentWeek('2026-10-25', 18, today).week, 1);
  assert.equal(computeCurrentWeek('2026-10-26', 18, today).status, 'not-started');
});

test('开学日期周一校验', () => {
  assert.equal(isMonday('2026-09-07'), true);
  assert.equal(isMonday('2026-09-08'), false);
  assert.equal(isMonday(''), null);
  assert.equal(isMonday('2026-13-01'), null);
});

test('时间冲突检测只提示同一周且节次重叠的课程', () => {
  const a = course({ id: 'a', startSection: 1, endSection: 2 });
  const b = course({ id: 'b', courseName: '大学英语', startSection: 2, endSection: 3 });
  const c = course({ id: 'c', courseName: '线性代数', weekday: 2 });
  const d = course({
    id: 'd',
    courseName: '程序设计',
    weekday: 4,
    weekRules: [rule(1, 18, 'odd')]
  });
  const e = course({
    id: 'e',
    courseName: '数据结构',
    weekday: 4,
    weekRules: [rule(2, 18, 'even')]
  });

  const conflicts = detectConflicts([a, b, c, d, e]);
  assert.deepEqual([...conflicts.keys()].sort(), ['a', 'b']);
  assert.match(conflicts.get('a')[0], /大学英语/);
});

test('课程归一化：缺失关键字段时保留记录并标记待确认', () => {
  const normalized = normalizeCourse(
    {
      courseName: '  地震学 ',
      weekday: 9,
      startSection: 0,
      endSection: 3,
      weekRules: [rule(1, 18, '双')]
    },
    { totalWeeks: 18 }
  );
  assert.equal(normalized.courseName, '地震学');
  assert.equal(normalized.weekday, 1);
  assert.equal(normalized.startSection, 1);
  assert.equal(normalized.endSection, 3);
  assert.deepEqual(normalized.weekRules, [rule(1, 18, 'all')]);
  for (const field of ['weekday', 'startSection']) {
    assert.ok(normalized.needsReview.includes(field), field);
  }
  assert.equal(normalized.needsReview.includes('weekRules'), false);
});

test('课程归一化：无周次规则时标记待确认，不伪造周次', () => {
  const normalized = normalizeCourse({ courseName: '体育', weekRules: [] }, { totalWeeks: 18 });
  assert.deepEqual(normalized.weekRules, []);
  assert.ok(normalized.needsReview.includes('weekRules'));
});

test('导入校验：版本号与字段范围', () => {
  const base = createTimetable();
  base.semester.startDate = '2026-09-07';
  base.courses = [course({ id: 'x' })];

  const ok = normalizeTimetable(JSON.parse(JSON.stringify(base)));
  assert.equal(ok.ok, true);
  assert.equal(ok.data.courses.length, 1);
  assert.equal(ok.data.semester.startDate, '2026-09-07');

  assert.equal(normalizeTimetable({ ...base, schemaVersion: 2 }).ok, false);
  assert.equal(normalizeTimetable(null).ok, false);

  const dirty = normalizeTimetable({
    ...base,
    semester: { ...base.semester, startDate: '2026-02-30', totalWeeks: 99 },
    courses: [{ courseName: '', weekday: 1 }]
  });
  assert.equal(dirty.data.semester.startDate, '');
  assert.equal(dirty.data.semester.totalWeeks, 18);
  assert.equal(dirty.data.courses.length, 0);
});

test('周次规则文案', () => {
  assert.equal(formatWeekRules([rule(1, 18)]), '1-18周');
  assert.equal(formatWeekRules([rule(1, 17, 'odd')]), '1-17周(单)');
  assert.equal(
    formatWeekRules([rule(1, 8), rule(10, 18, 'even')]),
    '1-8周、10-18周(双)'
  );
  assert.equal(formatWeekRules([]), '周次待确认');
});

function fakeResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body)
  };
}

test('识别接口：同源请求且请求体不包含密钥', async () => {
  let captured = null;
  const result = await recognizeSchedule('data:image/jpeg;base64,AAAA', {
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return fakeResponse({
        ok: true,
        data: { courses: [{ courseName: '高等数学' }], warnings: [] }
      });
    }
  });

  assert.equal(result.ok, true);
  assert.equal(captured.url, '/api/schedule/recognize');
  const body = JSON.parse(captured.options.body);
  assert.deepEqual(Object.keys(body), ['image']);
  assert.equal(body.image, 'data:image/jpeg;base64,AAAA');
});

test('识别接口：透传服务端错误码与重试标记', async () => {
  const result = await recognizeSchedule('data:image/jpeg;base64,AAAA', {
    fetchImpl: async () =>
      fakeResponse({
        ok: false,
        error: { code: 'NO_COURSES', message: '未识别出课程', retryable: false }
      })
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'NO_COURSES');
  assert.equal(result.error.retryable, false);
});
