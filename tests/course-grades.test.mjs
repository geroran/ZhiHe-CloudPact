import assert from "node:assert/strict";
import test from "node:test";

import {
  CourseGradesError,
  INFO_ENDPOINT,
  SEARCH_ENDPOINT,
  normalizeGrade,
  normalizeSearchResults,
  requestCourseGrade,
  requestCourseSearch,
  validateQuery,
} from "../src/modules/course-grades/api.js";
import {
  canGoNext,
  computeSegments,
  scoreText,
} from "../src/modules/course-grades/logic.js";

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

const GRADE = {
  avg: 89.625,
  usualAvg: 0,
  count: 16,
  finalAvg: 0,
  b6070: 0,
  maxScore: 97,
  u90: 11,
  b7080: 2,
  b8090: 3,
  midtermAvg: 0,
  d60: 0,
};

test("validateQuery 至少需要课程名或教师之一", () => {
  assert.equal(validateQuery({}).ok, false);
  assert.equal(validateQuery({ courseName: "  ", teacher: " " }).ok, false);
  assert.deepEqual(validateQuery({ courseName: " 数学（1） ", teacher: " 杨海燕 " }), {
    ok: true,
    courseName: "数学（1）",
    teacher: "杨海燕",
  });
  assert.equal(validateQuery({ courseName: "a".repeat(81) }).ok, false);
});

test("normalizeSearchResults 去重、去空白并丢弃空课程名", () => {
  const courses = normalizeSearchResults([
    { courseName: "高等数学F\n", courseTeacher: "丁红林" },
    { courseName: "高等数学F", courseTeacher: "丁红林" },
    { courseName: "", courseTeacher: "无名" },
    { courseName: "数学（1）", courseTeacher: null },
  ]);
  assert.deepEqual(courses, [
    { key: "高等数学F::丁红林", courseName: "高等数学F", courseTeacher: "丁红林" },
    { key: "数学（1）::", courseName: "数学（1）", courseTeacher: "" },
  ]);
});

test("normalizeGrade 在样本为 0 或缺失时返回 null", () => {
  assert.equal(normalizeGrade(null), null);
  assert.equal(normalizeGrade({ count: 0 }), null);
  assert.equal(normalizeGrade({ avg: 90 }), null);

  const grade = normalizeGrade(GRADE);
  assert.equal(grade.count, 16);
  assert.equal(grade.avg, 89.625);
  assert.equal(grade.u90, 11);
  assert.equal(normalizeGrade({ count: 5, avg: "90" }).avg, null);
});

test("computeSegments 按样本人数计算分数段占比", () => {
  const grade = normalizeGrade(GRADE);
  assert.deepEqual(computeSegments(grade), [
    { key: "u90", label: "90 分及以上", count: 11, percent: 68.8 },
    { key: "b8090", label: "80–89 分", count: 3, percent: 18.8 },
    { key: "b7080", label: "70–79 分", count: 2, percent: 12.5 },
    { key: "b6070", label: "60–69 分", count: 0, percent: 0 },
    { key: "d60", label: "60 分以下", count: 0, percent: 0 },
  ]);
  assert.deepEqual(computeSegments(null), []);
});

test("scoreText 保留一位小数，未提供时显示暂无", () => {
  assert.equal(scoreText(89.625), "89.6");
  assert.equal(scoreText(97), "97");
  assert.equal(scoreText(0), "暂无");
  assert.equal(scoreText(null), "暂无");
});

test("canGoNext 只在返回满页时允许继续翻页", () => {
  assert.equal(canGoNext(Array(15).fill({})), true);
  assert.equal(canGoNext(Array(14).fill({})), false);
  assert.equal(canGoNext(null), false);
});

test("requestCourseSearch 只把查询参数发给同源代理", async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options };
    return jsonResponse({
      ok: true,
      data: [{ courseName: "数学（1）", courseTeacher: "王娟" }],
    });
  };

  const result = await requestCourseSearch({
    courseName: " 数学 ",
    teacher: "",
    page: 2,
    fetchImpl,
  });

  assert.equal(captured.url, SEARCH_ENDPOINT);
  assert.equal(captured.options.method, "POST");
  assert.equal(captured.options.headers["x-wc-token"], undefined);
  assert.deepEqual(JSON.parse(captured.options.body), {
    courseName: "数学",
    teacher: "",
    page: 2,
  });
  assert.equal(result.page, 2);
  assert.deepEqual(result.courses, [
    { key: "数学（1）::王娟", courseName: "数学（1）", courseTeacher: "王娟" },
  ]);
});

test("requestCourseGrade 请求同源代理并在无样本时返回 null", async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options };
    return jsonResponse({ ok: true, data: null });
  };

  const grade = await requestCourseGrade({
    courseName: " 高等地震学\n ",
    teacher: " 杨海燕 ",
    fetchImpl,
  });

  assert.equal(grade, null);
  assert.equal(captured.url, INFO_ENDPOINT);
  assert.deepEqual(JSON.parse(captured.options.body), {
    courseName: "高等地震学",
    teacher: "杨海燕",
  });
});

test("代理错误映射为可读的 CourseGradesError", async () => {
  const unauthorized = async () =>
    jsonResponse({ ok: false, error: { code: "AUTH_FAILED", message: "登录凭证已失效" } }, 401);
  await assert.rejects(
    requestCourseSearch({ courseName: "数学", fetchImpl: unauthorized }),
    (error) => {
      assert.ok(error instanceof CourseGradesError);
      assert.equal(error.code, "AUTH_FAILED");
      assert.equal(error.retryable, false);
      return true;
    }
  );

  const timeout = async () =>
    jsonResponse({ ok: false, error: { code: "UPSTREAM_TIMEOUT", message: "超时" } }, 504);
  await assert.rejects(
    requestCourseGrade({ courseName: "数学", fetchImpl: timeout }),
    (error) => {
      assert.equal(error.code, "UPSTREAM_TIMEOUT");
      assert.equal(error.retryable, true);
      return true;
    }
  );
});
