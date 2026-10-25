import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PAGE_SIZE,
  applyFilters,
  buildRowEntries,
  collectFilterOptions,
  defaultSemester,
  formatScheduleTime,
  isBlank,
  matchesFilters,
  normalizePagePayload,
  parseScheduleText,
  rowKey,
  textOr,
  totalPages,
} from "../src/modules/teacher-course-search/course-utils.js";

test("isBlank only treats null/empty/literal null strings as blank", () => {
  for (const value of [null, undefined, "", "   ", "null", "NULL", "undefined"]) {
    assert.equal(isBlank(value), true, String(value));
  }
  for (const value of [0, "0", false, "授课"]) {
    assert.equal(isBlank(value), false, String(value));
  }
  assert.equal(textOr(null, "未提供"), "未提供");
  assert.equal(textOr("", "未提供"), "未提供");
  assert.equal(textOr(0, "未提供"), "0");
});

test("defaultSemester derives the current term and honours overrides", () => {
  assert.equal(defaultSemester(new Date(2026, 9, 25)), "2026-2027-1");
  assert.equal(defaultSemester(new Date(2026, 2, 1)), "2025-2026-2");
  assert.equal(defaultSemester(new Date(2026, 2, 1), "2025-2026-2"), "2025-2026-2");
});

test("totalPages always comes from totalSize, not rows.length", () => {
  assert.equal(totalPages(4, 10), 1);
  assert.equal(totalPages(11, 10), 2);
  assert.equal(totalPages(0, 10), 1);
  assert.equal(totalPages("25", 10), 3);
  assert.equal(totalPages(Number.NaN, 10), 1);
  assert.equal(DEFAULT_PAGE_SIZE, 10);
});

test("row keys keep different KXH teaching classes apart", () => {
  const first = { KCH: "YN001", KXH: "01" };
  const second = { KCH: "YN001", KXH: "02" };
  assert.equal(rowKey(first), "YN001|01");
  assert.equal(rowKey(second), "YN001|02");
  assert.notEqual(rowKey(first), rowKey(second));
  assert.equal(rowKey({ JXBID: "jx-1", KCH: "YN001", KXH: "01" }), "jx-1");

  const entries = buildRowEntries([first, second, { ...first }]);
  assert.equal(entries[0].key, "YN001|01");
  assert.equal(entries[1].key, "YN001|02");
  assert.equal(entries[2].key, "YN001|01#2");
});

test("parses a single ehall schedule arrangement", () => {
  const result = parseScheduleText("3-18周 星期四 3-4节 力行楼4307");
  assert.equal(result.empty, false);
  assert.equal(result.items.length, 1);
  const item = result.items[0];
  assert.equal(item.parsed, true);
  assert.equal(item.weeks, "3-18周");
  assert.equal(item.weekday, "星期四");
  assert.equal(item.periods, "3-4节");
  assert.equal(item.place, "力行楼4307");
  assert.equal(formatScheduleTime(item), "3–18 周 · 星期四 · 第 3–4 节");
});

test("splits and parses multiple arrangements in one YPSJDD value", () => {
  const raw =
    "4-18周 星期五 5-6节 格物楼4栋4108,4-9周 星期一 5-6节 格物楼4栋4410,10-18周 星期一 5-6节 格物楼1栋1105";
  const result = parseScheduleText(raw);
  assert.equal(result.items.length, 3);
  assert.ok(result.items.every((item) => item.parsed));
  assert.equal(result.items[1].weeks, "4-9周");
  assert.equal(result.items[2].place, "格物楼1栋1105");

  const chineseCommas = parseScheduleText("1-4周 星期二 1-2节 文汇楼，5-8周 星期三 3-4节 格物楼");
  assert.equal(chineseCommas.items.length, 2);
});

test("keeps raw text when a schedule fragment cannot be parsed", () => {
  const result = parseScheduleText("3-18周 星期四 3-4节 力行楼4307,时间待定");
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].parsed, true);
  assert.equal(result.items[1].parsed, false);
  assert.equal(result.items[1].raw, "时间待定");
  assert.equal(formatScheduleTime(result.items[1]), "时间待定");

  const unparseable = parseScheduleText("具体安排另行通知");
  assert.equal(unparseable.items[0].parsed, false);
  assert.equal(unparseable.raw, "具体安排另行通知");
});

test("handles empty schedules and arrangements without a week range", () => {
  const empty = parseScheduleText(null);
  assert.equal(empty.empty, true);
  assert.deepEqual(empty.items, []);

  const noWeeks = parseScheduleText("星期一 第1-2节 文汇楼");
  assert.equal(noWeeks.items[0].parsed, true);
  assert.equal(noWeeks.items[0].weeks, "");
  assert.equal(noWeeks.items[0].weekday, "星期一");
  assert.equal(formatScheduleTime(noWeeks.items[0]), "星期一 · 第 1–2 节");
});

test("collects filter options from loaded rows and ignores blanks", () => {
  const rows = [
    { BQDM_DISPLAY: "理论课", XGXKLBDM_DISPLAY: "自然科学", XXXQDM_DISPLAY: "呈贡校区" },
    { BQDM_DISPLAY: "实验课", XGXKLBDM_DISPLAY: "", XXXQDM_DISPLAY: "呈贡校区" },
    { BQDM_DISPLAY: "理论课", XGXKLBDM_DISPLAY: null, XXXQDM_DISPLAY: "东陆校区" },
  ];
  assert.deepEqual(collectFilterOptions(rows, "BQDM_DISPLAY"), ["理论课", "实验课"]);
  assert.deepEqual(collectFilterOptions(rows, "XGXKLBDM_DISPLAY"), ["自然科学"]);
  assert.deepEqual(collectFilterOptions(rows, "XXXQDM_DISPLAY"), ["呈贡校区", "东陆校区"]);
});

test("applies filters only to the current page rows", () => {
  const rows = [
    { KCM: "A", BQDM_DISPLAY: "理论课", XGXKLBDM_DISPLAY: "国际化视野", XXXQDM_DISPLAY: "呈贡校区" },
    { KCM: "B", BQDM_DISPLAY: "实验课", XGXKLBDM_DISPLAY: "自然科学", XXXQDM_DISPLAY: "东陆校区" },
    { KCM: "C", BQDM_DISPLAY: "理论课", XGXKLBDM_DISPLAY: "", XXXQDM_DISPLAY: "呈贡校区" },
  ];
  assert.equal(applyFilters(rows, {}).length, 3);
  assert.equal(applyFilters(rows, { type: "理论课" }).length, 2);
  assert.equal(applyFilters(rows, { type: "理论课", campus: "东陆校区" }).length, 0);
  assert.equal(applyFilters(rows, { category: "自然科学" })[0].KCM, "B");
  assert.equal(matchesFilters(rows[0], { type: "", category: "", campus: "" }), true);
});

test("normalizePagePayload validates rows and keeps totalSize authoritative", () => {
  const data = normalizePagePayload({
    source: "live",
    totalSize: "23",
    pageNumber: "2",
    pageSize: "10",
    rows: [{ KCM: "A" }],
  });
  assert.equal(data.totalSize, 23);
  assert.equal(data.pageNumber, 2);
  assert.equal(data.pageSize, 10);
  assert.equal(data.rows.length, 1);

  assert.throws(() => normalizePagePayload({ rows: null }), (error) => error.code === "BAD_RESPONSE");
  assert.throws(() => normalizePagePayload(null), (error) => error.code === "BAD_RESPONSE");

  const fallback = normalizePagePayload({ rows: [{}, {}] });
  assert.equal(fallback.totalSize, 2);
  assert.equal(fallback.pageNumber, 1);
});
