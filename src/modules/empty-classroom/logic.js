/**
 * 空教室查询的纯逻辑：选项校验、默认条件、请求参数、结果归一化、分组与筛选。
 * 这里不依赖 DOM，也不发请求，方便单元测试与后续主站复用。
 */

export const SECTION_MIN = 1;
export const SECTION_MAX = 12;
export const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

const BUILDING_PRIORITY = ['格物楼', '力行楼', '文汇楼'];
const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' });

export function toInteger(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return null;
}

export function toText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeSeats(value) {
  const seats = toInteger(value);
  return seats !== null && seats > 0 ? seats : null;
}

export function weekdayNumber(date) {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

export function parseTermStart(value) {
  if (typeof value !== 'string' || !/^\d{8}$/.test(value.trim())) return null;
  const text = value.trim();
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(4, 6));
  const day = Number(text.slice(6, 8));
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

/**
 * 按学期开始日期估算当前教学周。开始日期之前按第 1 周处理。
 */
export function estimateWeek(termStart, now = new Date()) {
  const start = typeof termStart === 'string' ? parseTermStart(termStart) : termStart;
  if (!(start instanceof Date) || Number.isNaN(start.getTime())) return null;
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.floor((today - startDay) / 86400000);
  if (diffDays < 0) return 1;
  return Math.floor(diffDays / 7) + 1;
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function nameList(value) {
  if (!Array.isArray(value)) return null;
  const names = [];
  for (const item of value) {
    const name = toText(item);
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * 只接受真实选项接口返回的字段，缺失关键字段时明确失败，不使用内置默认值兜底。
 */
export function normalizeOptions(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, message: '选项接口返回内容为空' };
  }

  const campuses = nameList(raw.campuses);
  if (campuses === null) {
    return { ok: false, message: '选项接口未返回校区列表（campuses）' };
  }
  if (campuses.length === 0) {
    return { ok: false, message: '选项接口返回的校区列表为空' };
  }

  const buildings = nameList(raw.buildings);
  if (buildings === null) {
    return { ok: false, message: '选项接口未返回教学楼列表（buildings）' };
  }

  const maxWeek = toInteger(raw.max_week);
  if (maxWeek === null || maxWeek < 1) {
    return { ok: false, message: '选项接口未返回有效的最大周次（max_week）' };
  }

  const term = raw.term && typeof raw.term === 'object' ? raw.term : null;
  const termName = toText(term && term.XNXQMC);
  if (!termName) {
    return { ok: false, message: '选项接口未返回学期名称（term.XNXQMC）' };
  }

  const termStartText = toText(term && term.XQKSSJ);
  const termStart = parseTermStart(termStartText) ? termStartText : null;

  return {
    ok: true,
    options: {
      campuses,
      buildings,
      maxWeek,
      termName,
      termStart,
    },
  };
}

export function defaultSelection(options, now = new Date()) {
  const campus = options.campuses.includes('呈贡校区') ? '呈贡校区' : options.campuses[0];
  const estimatedWeek = estimateWeek(options.termStart, now);
  const week = clamp(estimatedWeek === null ? 1 : estimatedWeek, 1, options.maxWeek);
  return {
    campus,
    week,
    day: weekdayNumber(now),
    sections: [1, 2],
    building: '',
  };
}

export function normalizeSections(value) {
  if (!Array.isArray(value)) {
    return { ok: false, message: '节次必须为数组' };
  }
  const sections = [];
  for (const item of value) {
    const section = toInteger(item);
    if (section === null || section < SECTION_MIN || section > SECTION_MAX) {
      return { ok: false, message: `节次只能在 ${SECTION_MIN}–${SECTION_MAX} 之间` };
    }
    if (!sections.includes(section)) sections.push(section);
  }
  if (sections.length === 0) {
    return { ok: false, message: '请至少选择一个节次' };
  }
  sections.sort((a, b) => a - b);
  return { ok: true, sections };
}

export function buildQueryPayload(selection, maxWeek) {
  const campus = toText(selection.campus);
  if (!campus) return { ok: false, message: '请选择校区' };

  const week = toInteger(selection.week);
  if (week === null || week < 1 || week > maxWeek) {
    return { ok: false, message: `教学周需在 1–${maxWeek} 之间` };
  }

  const day = toInteger(selection.day);
  if (day === null || day < 1 || day > 7) {
    return { ok: false, message: '星期需在 1–7 之间' };
  }

  const sections = normalizeSections(selection.sections);
  if (!sections.ok) return sections;

  return {
    ok: true,
    payload: {
      campus,
      target_week: week,
      day_of_week: day,
      sections: sections.sections,
      building: toText(selection.building),
    },
  };
}

function roomName(raw) {
  const name = toText(raw.classroom_name);
  if (name) return name;
  return toText(raw.classroom_code);
}

/**
 * 保留接口返回的真实教室，只做展示层的字段归一化。
 * borrowable 必须严格等于 true，避免字符串 "true" 被误判。
 */
export function normalizeRooms(data) {
  if (!Array.isArray(data)) {
    return { ok: false, message: '查询接口返回的 data 不是数组' };
  }
  const rooms = data.map((raw) => {
    const item = raw && typeof raw === 'object' ? raw : {};
    return {
      classroomName: roomName(item) || '未命名教室',
      classroomCode: toText(item.classroom_code),
      buildingName: toText(item.building_name) || '未标注教学楼',
      seats: normalizeSeats(item.seats),
      borrowable: item.borrowable === true,
    };
  });
  return { ok: true, rooms };
}

export function isFilterActive(filters) {
  if (!filters) return false;
  const keyword = toText(filters.keyword);
  const minSeats = toInteger(filters.minSeats);
  return Boolean(keyword) || (minSeats !== null && minSeats > 0) || filters.borrowableOnly === true;
}

export function applyFilters(rooms, filters) {
  const keyword = toText(filters && filters.keyword).toLocaleLowerCase('zh-CN');
  const minSeats = toInteger(filters && filters.minSeats);
  const requireSeats = minSeats !== null && minSeats > 0;
  const onlyBorrowable = filters && filters.borrowableOnly === true;

  return rooms.filter((room) => {
    if (keyword) {
      const haystack = `${room.classroomName} ${room.classroomCode}`.toLocaleLowerCase('zh-CN');
      if (!haystack.includes(keyword)) return false;
    }
    if (requireSeats && (room.seats === null || room.seats < minSeats)) return false;
    if (onlyBorrowable && room.borrowable !== true) return false;
    return true;
  });
}

function buildingPriority(name) {
  const index = BUILDING_PRIORITY.findIndex((prefix) => name.startsWith(prefix));
  return index === -1 ? BUILDING_PRIORITY.length : index;
}

/**
 * 按教学楼分组：格物楼、力行楼、文汇楼优先，其余按名称拼音排序；
 * 组内按教室名称排序。
 */
export function groupRooms(rooms) {
  const groups = new Map();
  for (const room of rooms) {
    if (!groups.has(room.buildingName)) groups.set(room.buildingName, []);
    groups.get(room.buildingName).push(room);
  }

  return [...groups.entries()]
    .map(([name, items]) => ({
      name,
      rooms: items.slice().sort((a, b) => collator.compare(a.classroomName, b.classroomName)),
    }))
    .sort((a, b) => {
      const priorityDiff = buildingPriority(a.name) - buildingPriority(b.name);
      return priorityDiff !== 0 ? priorityDiff : collator.compare(a.name, b.name);
    });
}

export function describeQuery(payload) {
  if (!payload) return '尚未查询';
  const dayLabel = WEEKDAY_LABELS[payload.day_of_week - 1] || `星期 ${payload.day_of_week}`;
  const building = payload.building ? payload.building : '全部教学楼';
  return `${payload.campus} · 第 ${payload.target_week} 周 · ${dayLabel} · 第 ${payload.sections.join('、')} 节 · ${building}`;
}
