/**
 * 周次与单双周规则：周次筛选、当前周计算、时间冲突检测。
 * 全部为纯函数；切换周次时只做本地筛选，不发起任何网络请求。
 */
import { parseLocalDate, formatSections, WEEKDAY_LABELS } from './model.js';

export function ruleMatchesWeek(rule, weekNo) {
  if (!rule || !Number.isFinite(weekNo)) return false;
  if (weekNo < rule.from || weekNo > rule.to) return false;
  if (rule.parity === 'odd') return weekNo % 2 === 1;
  if (rule.parity === 'even') return weekNo % 2 === 0;
  return true;
}

export function courseMatchesWeek(course, weekNo) {
  if (!Array.isArray(course?.weekRules) || !course.weekRules.length) return false;
  return course.weekRules.some((rule) => ruleMatchesWeek(rule, weekNo));
}

const SECTION_SORT = (a, b) =>
  a.weekday - b.weekday || a.startSection - b.startSection || a.courseName.localeCompare(b.courseName, 'zh');

export function coursesForWeek(courses, weekNo) {
  return (Array.isArray(courses) ? courses : [])
    .filter((course) => courseMatchesWeek(course, weekNo))
    .slice()
    .sort(SECTION_SORT);
}

/**
 * 以“第一周周一”为起点计算当前周。
 * @returns {{ status: 'unset'|'not-started'|'ended'|'ok', week: number|null, message: string }}
 */
export function computeCurrentWeek(startDate, totalWeeks, today = new Date()) {
  const start = parseLocalDate(startDate);
  if (!start) {
    return {
      status: 'unset',
      week: null,
      message: '尚未设置开学日期，只能手动选择周次'
    };
  }

  const current = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.floor((current.getTime() - start.getTime()) / dayMs);

  if (diffDays < 0) {
    return {
      status: 'not-started',
      week: 1,
      message: '学期尚未开始，已显示第 1 周'
    };
  }

  const week = Math.floor(diffDays / 7) + 1;
  if (week > totalWeeks) {
    return {
      status: 'ended',
      week: totalWeeks,
      message: `本学期已结束（共 ${totalWeeks} 周），已显示最后一周`
    };
  }
  return { status: 'ok', week, message: `当前第 ${week} 周` };
}

/** 开学日期应是第一周周一；返回是否为周一，或 null 表示未设置/非法。 */
export function isMonday(dateString) {
  const date = parseLocalDate(dateString);
  if (!date) return null;
  return date.getDay() === 1;
}

export function conflictKey(course) {
  return `${course.weekday}|${course.startSection}|${course.endSection}`;
}

/**
 * 找出同一周、同一星期、节次重叠的课程对（仅提示，不自动删除）。
 * @returns {Map<string, string[]>} courseId -> 冲突描述数组
 */
export function detectConflicts(courses) {
  const result = new Map();
  const list = Array.isArray(courses) ? courses : [];

  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i];
      const b = list[j];
      if (a.weekday !== b.weekday) continue;
      if (a.startSection > b.endSection || b.startSection > a.endSection) continue;
      if (!rulesOverlap(a.weekRules, b.weekRules)) continue;

      const label = `${WEEKDAY_LABELS[a.weekday]} ${formatSections(a)}`;
      pushMessage(result, a.id, `与「${b.courseName}」在${label}时间重叠`);
      pushMessage(result, b.id, `与「${a.courseName}」在${label}时间重叠`);
    }
  }
  return result;
}

function pushMessage(map, id, message) {
  if (!map.has(id)) map.set(id, []);
  map.get(id).push(message);
}

function rulesOverlap(rulesA, rulesB) {
  if (!Array.isArray(rulesA) || !Array.isArray(rulesB)) return false;
  for (const a of rulesA) {
    for (const b of rulesB) {
      const from = Math.max(a.from, b.from);
      const to = Math.min(a.to, b.to);
      if (from > to) continue;
      for (let week = from; week <= to; week += 1) {
        if (ruleMatchesWeek(a, week) && ruleMatchesWeek(b, week)) return true;
      }
    }
  }
  return false;
}

/** 找出与已有课程冲突的候选课程（用于编辑时提示）。 */
export function findConflictsFor(candidate, courses) {
  const others = (Array.isArray(courses) ? courses : []).filter((item) => item.id !== candidate.id);
  const merged = [...others, candidate];
  return detectConflicts(merged).get(candidate.id) || [];
}
