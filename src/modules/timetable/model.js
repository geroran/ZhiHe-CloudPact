/**
 * 课表数据模型：默认学期、课程归一化、校验与展示辅助。
 *
 * 数据结构见 plan/详细方案/课表.md：单学期对象 + courses 数组。
 * 所有函数均是纯函数，便于单元测试与后续并入其他页面。
 */

export const SCHEMA_VERSION = 1;

export const WEEKDAY_LABELS = Object.freeze({
  1: '周一',
  2: '周二',
  3: '周三',
  4: '周四',
  5: '周五',
  6: '周六',
  7: '周日'
});

export const PARITY_LABELS = Object.freeze({
  all: '每周',
  odd: '单周',
  even: '双周'
});

export const DEFAULT_PERIODS = Object.freeze([
  { section: 1, startTime: '08:00', endTime: '08:45' },
  { section: 2, startTime: '08:55', endTime: '09:40' },
  { section: 3, startTime: '10:00', endTime: '10:45' },
  { section: 4, startTime: '10:55', endTime: '11:40' },
  { section: 5, startTime: '14:00', endTime: '14:45' },
  { section: 6, startTime: '14:55', endTime: '15:40' },
  { section: 7, startTime: '16:00', endTime: '16:45' },
  { section: 8, startTime: '16:55', endTime: '17:40' },
  { section: 9, startTime: '19:00', endTime: '19:45' },
  { section: 10, startTime: '19:55', endTime: '20:40' },
  { section: 11, startTime: '20:50', endTime: '21:35' },
  { section: 12, startTime: '21:45', endTime: '22:30' }
]);

const DEFAULT_TOTAL_WEEKS = 18;
const MAX_TOTAL_WEEKS = 30;

export function createTimetable(overrides = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    semester: {
      id: overrides.semester?.id || '',
      name: overrides.semester?.name || '',
      startDate: overrides.semester?.startDate || '',
      totalWeeks: normalizeTotalWeeks(overrides.semester?.totalWeeks)
    },
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    periods: normalizePeriods(overrides.periods),
    courses: []
  };
}

export function normalizeTotalWeeks(value, fallback = DEFAULT_TOTAL_WEEKS) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number) || number < 1 || number > MAX_TOTAL_WEEKS) return fallback;
  return number;
}

export function normalizePeriods(input) {
  const source = Array.isArray(input) ? input : [];
  const bySection = new Map();
  for (const item of source) {
    const section = Number.parseInt(item?.section, 10);
    if (!Number.isFinite(section) || section < 1) continue;
    bySection.set(section, {
      section,
      startTime: normalizeTime(item?.startTime),
      endTime: normalizeTime(item?.endTime)
    });
  }
  return DEFAULT_PERIODS.map((fallback) => bySection.get(fallback.section) || { ...fallback });
}

function normalizeTime(value) {
  if (typeof value !== 'string') return '';
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return '';
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

let sequence = 0;

export function makeCourseId() {
  sequence += 1;
  return `course-${Date.now().toString(36)}-${sequence}`;
}

export function normalizeWeekRules(rules) {
  const source = Array.isArray(rules) ? rules : rules && typeof rules === 'object' ? [rules] : [];
  const normalized = [];
  for (const item of source) {
    const from = Number.parseInt(item?.from, 10);
    const to = Number.parseInt(item?.to, 10);
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    if (from < 1 || to < from) continue;
    const parity = ['all', 'odd', 'even'].includes(item?.parity) ? item.parity : 'all';
    normalized.push({
      from: Math.min(from, MAX_TOTAL_WEEKS),
      to: Math.min(to, MAX_TOTAL_WEEKS),
      parity
    });
  }
  return normalized;
}

/**
 * 归一化一条课程记录。关键字段缺失时保留记录并写入 needsReview，
 * 由用户在核对界面修正，不静默丢弃。
 */
export function normalizeCourse(raw, options = {}) {
  const totalWeeks = normalizeTotalWeeks(options.totalWeeks);
  const needsReview = new Set(
    Array.isArray(raw?.needsReview) ? raw.needsReview.map((item) => String(item)) : []
  );

  const courseName = typeof raw?.courseName === 'string' ? raw.courseName.trim().slice(0, 80) : '';
  if (!courseName) return null;

  let weekday = Number.parseInt(raw?.weekday, 10);
  if (!Number.isFinite(weekday) || weekday < 1 || weekday > 7) {
    weekday = 1;
    needsReview.add('weekday');
  }

  let startSection = Number.parseInt(raw?.startSection, 10);
  if (!Number.isFinite(startSection) || startSection < 1) {
    startSection = 1;
    needsReview.add('startSection');
  }
  let endSection = Number.parseInt(raw?.endSection, 10);
  if (!Number.isFinite(endSection) || endSection < startSection) {
    endSection = startSection;
    needsReview.add('endSection');
  }
  if (endSection > 12) {
    endSection = 12;
    startSection = Math.min(startSection, endSection);
    needsReview.add('endSection');
  }

  let weekRules = normalizeWeekRules(raw?.weekRules);
  if (!weekRules.length) {
    needsReview.add('weekRules');
  }
  for (const rule of weekRules) {
    if (rule.to > totalWeeks) {
      needsReview.add('weekRules');
      break;
    }
  }

  return {
    id: typeof raw?.id === 'string' && raw.id ? raw.id : makeCourseId(),
    courseName,
    teacher: typeof raw?.teacher === 'string' ? raw.teacher.trim().slice(0, 40) : '',
    classroom: typeof raw?.classroom === 'string' ? raw.classroom.trim().slice(0, 60) : '',
    weekday,
    startSection,
    endSection,
    weekRules,
    rawText: typeof raw?.rawText === 'string' ? raw.rawText.slice(0, 500) : '',
    needsReview: [...needsReview],
    source: raw?.source === 'manual' ? 'manual' : 'ai'
  };
}

export function normalizeTimetable(input) {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: '课表数据不是 JSON 对象' };
  }
  if (Number.parseInt(input.schemaVersion, 10) !== SCHEMA_VERSION) {
    return { ok: false, error: `课表版本不受支持（需要 schemaVersion=${SCHEMA_VERSION}）` };
  }

  const totalWeeks = normalizeTotalWeeks(input.semester?.totalWeeks);
  const courses = [];
  const rawCourses = Array.isArray(input.courses) ? input.courses : [];
  for (const item of rawCourses) {
    const course = normalizeCourse(item, { totalWeeks });
    if (course) courses.push(course);
  }

  return {
    ok: true,
    data: {
      schemaVersion: SCHEMA_VERSION,
      semester: {
        id: typeof input.semester?.id === 'string' ? input.semester.id.slice(0, 60) : '',
        name: typeof input.semester?.name === 'string' ? input.semester.name.slice(0, 80) : '',
        startDate: normalizeDateString(input.semester?.startDate),
        totalWeeks
      },
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      periods: normalizePeriods(input.periods),
      courses
    }
  };
}

export function normalizeDateString(value) {
  const date = parseLocalDate(value);
  if (!date) return '';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** 把 YYYY-MM-DD 解析为本地零点日期；非法日期返回 null。 */
export function parseLocalDate(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (
    date.getFullYear() !== Number(match[1]) ||
    date.getMonth() !== Number(match[2]) - 1 ||
    date.getDate() !== Number(match[3])
  ) {
    return null;
  }
  return date;
}

export function formatWeekRules(rules) {
  if (!Array.isArray(rules) || !rules.length) return '周次待确认';
  return rules
    .map((rule) => {
      const range = rule.from === rule.to ? `第${rule.from}周` : `${rule.from}-${rule.to}周`;
      if (rule.parity === 'odd') return `${range}(单)`;
      if (rule.parity === 'even') return `${range}(双)`;
      return range;
    })
    .join('、');
}

export function formatSections(course) {
  const start = Math.max(1, course.startSection);
  const end = Math.max(start, course.endSection);
  return start === end ? `第${start}节` : `第${start}-${end}节`;
}

export function semesterLabel(timetable) {
  const name = timetable?.semester?.name?.trim();
  return name || '当前学期';
}
