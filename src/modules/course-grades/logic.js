import { PAGE_SIZE } from "./api.js";

export const SEGMENT_DEFINITIONS = [
  { key: "u90", label: "90 分及以上" },
  { key: "b8090", label: "80–89 分" },
  { key: "b7080", label: "70–79 分" },
  { key: "b6070", label: "60–69 分" },
  { key: "d60", label: "60 分以下" },
];

export function hasGradeData(grade) {
  return Boolean(grade && typeof grade === "object" && Number(grade.count) > 0);
}

export function isScoreAvailable(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** 分数保留一位小数；缺值或 0 表示接口未提供该维度。 */
export function scoreText(value, { fallback = "暂无", decimals = 1 } = {}) {
  if (!isScoreAvailable(value)) return fallback;
  const fixed = value.toFixed(decimals);
  return fixed.replace(/\.0+$/, "");
}

export function countText(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? String(value)
    : "暂无";
}

/**
 * 按样本人数计算各分数段占比。
 */
export function computeSegments(grade) {
  if (!hasGradeData(grade)) return [];
  const total = grade.count;

  return SEGMENT_DEFINITIONS.map(({ key, label }) => {
    const raw = grade[key];
    const count = typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : 0;
    const percent = total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
    return { key, label, count, percent };
  });
}

/** 上游每页固定 15 条；返回满页时允许继续翻页。 */
export function canGoNext(courses) {
  return Array.isArray(courses) && courses.length >= PAGE_SIZE;
}
