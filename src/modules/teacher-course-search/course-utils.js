/**
 * Pure helpers for the teacher/course query module.
 * Kept free of DOM and network access so they can be unit tested directly.
 */

export const DEFAULT_PAGE_SIZE = 10;

export const QUERY_MODES = {
  teacher: {
    field: "SKJS",
    caption: "上课教师",
    label: "教师姓名",
    placeholder: "例如：杨海燕",
  },
  course: {
    field: "KCM",
    caption: "课程名",
    label: "课程名称",
    placeholder: "例如：非洲",
  },
};

/** True for null/undefined/empty strings and the literal strings "null"/"undefined". */
export function isBlank(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return true;
    const lower = trimmed.toLowerCase();
    return lower === "null" || lower === "undefined";
  }
  return false;
}

/** Safe display text: never renders null/undefined/empty as data. */
export function textOr(value, fallback = "—") {
  return isBlank(value) ? fallback : String(value).trim();
}

/**
 * Derive the semester code from a date when no explicit override is configured.
 * September–January maps to the autumn term, February–July to the spring term.
 */
export function defaultSemester(date = new Date(), override = "") {
  if (typeof override === "string" && override.trim() !== "") return override.trim();
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  return month >= 8 ? `${year}-${year + 1}-1` : `${year - 1}-${year}-2`;
}

/** Total pages from totalSize (never from rows.length). Page numbers start at 1. */
export function totalPages(totalSize, pageSize = DEFAULT_PAGE_SIZE) {
  const size = Number(totalSize);
  const per = Number(pageSize);
  if (!Number.isFinite(size) || size <= 0) return 1;
  if (!Number.isFinite(per) || per <= 0) return 1;
  return Math.max(1, Math.ceil(size / per));
}

/**
 * Stable identity for a row: JXBID first, then KCH + KXH.
 * Different KXH values must stay separate.
 */
export function rowKey(row, index = 0) {
  const jxbid = isBlank(row?.JXBID) ? "" : String(row.JXBID);
  if (jxbid) return jxbid;
  const kch = isBlank(row?.KCH) ? "" : String(row.KCH);
  const kxh = isBlank(row?.KXH) ? "" : String(row.KXH);
  if (kch) return `${kch}|${kxh}`;
  return `row-${index}`;
}

/** Adds a suffix only when the base key repeats, so list keys stay unique. */
export function buildRowEntries(rows) {
  const seen = new Map();
  return (Array.isArray(rows) ? rows : []).map((row, index) => {
    const base = rowKey(row, index);
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    return { row, key: count > 1 ? `${base}#${count}` : base };
  });
}

const WEEKDAY_PATTERN = "星期[一二三四五六日天]|周[一二三四五六日天]";

// "3-18周 星期四 3-4节 力行楼4307", with an optional "(单)"/"(双)" suffix.
const SCHEDULE_WITH_WEEKS = new RegExp(
  "^(?<weeks>\\d+(?:\\s*[-~—～至]\\s*\\d+)?\\s*周(?:\\s*[（(][^）)]{1,12}[）)])?)\\s*" +
    `(?<weekday>${WEEKDAY_PATTERN})\\s*` +
    "(?<periods>(?:第\\s*)?\\d+(?:\\s*[-~—～至]\\s*\\d+)?\\s*节)\\s*" +
    "(?<place>.*)$",
);

// Some records omit the week range; still worth showing weekday/period/place.
const SCHEDULE_WITHOUT_WEEKS = new RegExp(
  `^(?<weekday>${WEEKDAY_PATTERN})\\s*` +
    "(?<periods>(?:第\\s*)?\\d+(?:\\s*[-~—～至]\\s*\\d+)?\\s*节)\\s*" +
    "(?<place>.*)$",
);

function cleanGroup(value) {
  return isBlank(value) ? "" : String(value).trim();
}

/** Splits "a,b" / Chinese commas / semicolons / newlines into separate arrangements. */
export function splitSchedule(raw) {
  if (isBlank(raw)) return [];
  return String(raw)
    .split(/[,，;；\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Parses one arrangement. Returns { parsed: false, raw } when the text does not
 * match a known shape, so callers can always fall back to the original text.
 */
export function parseSchedulePart(part) {
  const raw = String(part || "").trim();
  if (raw === "") return { parsed: false, raw };
  const match = raw.match(SCHEDULE_WITH_WEEKS) || raw.match(SCHEDULE_WITHOUT_WEEKS);
  if (!match?.groups) return { parsed: false, raw };
  return {
    parsed: true,
    raw,
    weeks: cleanGroup(match.groups.weeks),
    weekday: cleanGroup(match.groups.weekday),
    periods: cleanGroup(match.groups.periods),
    place: cleanGroup(match.groups.place),
  };
}

/**
 * Parses a full YPSJDD value. Never hides information: unparsed parts keep raw text.
 * Returns { empty: true } for missing values.
 */
export function parseScheduleText(raw) {
  if (isBlank(raw)) return { empty: true, raw: "", items: [] };
  const parts = splitSchedule(raw);
  return { empty: false, raw: String(raw), items: parts.map(parseSchedulePart) };
}

function normalizeRange(text) {
  return String(text)
    .replace(/\s*[-~—～至]\s*/g, "–")
    .replace(/\s+/g, " ")
    .replace(/周$/, " 周")
    .trim();
}

function normalizeWeekday(text) {
  if (text.startsWith("周")) return `星期${text.slice(1)}`;
  return text;
}

/** "3-18 周 · 星期四 · 第 3–4 节" for parsed items, raw text otherwise. */
export function formatScheduleTime(item) {
  if (!item || !item.parsed) return (item && item.raw) || "";
  const bits = [];
  if (item.weeks) bits.push(normalizeRange(item.weeks));
  if (item.weekday) bits.push(normalizeWeekday(item.weekday));
  if (item.periods) {
    bits.push(`第 ${normalizeRange(item.periods.replace(/^第\s*/, "").replace(/\s*节$/, ""))} 节`);
  }
  return bits.join(" · ");
}

/** Unique, sorted, non-empty values for a display field across loaded rows. */
export function collectFilterOptions(rows, field) {
  const values = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const value = row?.[field];
    if (!isBlank(value)) values.add(String(value).trim());
  }
  return Array.from(values).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

/** Filters only the already-loaded page. Empty filter means "all". */
export function matchesFilters(row, filters = {}) {
  const checks = [
    ["BQDM_DISPLAY", filters.type],
    ["XGXKLBDM_DISPLAY", filters.category],
    ["XXXQDM_DISPLAY", filters.campus],
  ];
  return checks.every(([field, expected]) => {
    if (isBlank(expected)) return true;
    return textOr(row?.[field], "") === String(expected).trim();
  });
}

export function applyFilters(rows, filters) {
  const list = Array.isArray(rows) ? rows : [];
  if (
    isBlank(filters?.type) &&
    isBlank(filters?.category) &&
    isBlank(filters?.campus)
  ) {
    return list.slice();
  }
  return list.filter((row) => matchesFilters(row, filters));
}

/**
 * Validates the proxy payload. Throws a client error object that the view can
 * map to a friendly message.
 */
export function normalizePagePayload(data) {
  if (!data || typeof data !== "object") {
    throw Object.assign(new Error("服务返回数据为空"), {
      code: "BAD_RESPONSE",
      retryable: true,
    });
  }
  if (!Array.isArray(data.rows)) {
    throw Object.assign(new Error("服务返回缺少课程列表"), {
      code: "BAD_RESPONSE",
      retryable: true,
    });
  }
  const totalSize = Number(data.totalSize);
  const pageNumber = Number(data.pageNumber);
  const pageSize = Number(data.pageSize);
  return {
    source: typeof data.source === "string" ? data.source : "live",
    totalSize: Number.isFinite(totalSize) && totalSize >= 0 ? totalSize : data.rows.length,
    pageNumber: Number.isFinite(pageNumber) && pageNumber >= 1 ? pageNumber : 1,
    pageSize: Number.isFinite(pageSize) && pageSize >= 1 ? pageSize : DEFAULT_PAGE_SIZE,
    rows: data.rows,
  };
}
