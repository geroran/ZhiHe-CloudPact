import assert from "node:assert/strict";
import test from "node:test";

import {
  TermCoursesError,
  displayValue,
  filterCourses,
  normalizeCourse,
  normalizeTermCode,
  requestTermCourses,
  validateTermCode,
} from "../src/modules/term-course-list/api.js";

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

const COURSE = {
  uid: "20211170240",
  courseName: "大学英语听说（4）",
  courseId: "YN3004170007",
  courseTeacher: "邓杉",
  courseDetailInfo: "1-18周 星期二 7-8节 格物楼2栋2408",
  termCode: "2022-2023-1",
  id: "20211170240::YN3004170007::2022-2023-1",
};

test("displayValue 将 null、缺字段和字面值 null 显示为暂无", () => {
  assert.equal(displayValue(null), "暂无");
  assert.equal(displayValue(undefined), "暂无");
  assert.equal(displayValue("null"), "暂无");
  assert.equal(displayValue("   "), "暂无");
  assert.equal(displayValue("邓杉"), "邓杉");
  assert.equal(displayValue(0), "0");
  assert.equal(displayValue("", "教师信息暂无"), "教师信息暂无");
});

test("validateTermCode 拒绝空值和非法字符，不内置默认学期", () => {
  assert.deepEqual(validateTermCode(""), { ok: false, message: "请输入学期代码" });
  assert.equal(validateTermCode("   ").ok, false);
  assert.equal(validateTermCode("2022-2023-1").ok, true);
  assert.equal(validateTermCode("2022-2023-1").termCode, "2022-2023-1");
  assert.equal(validateTermCode("../etc").ok, false);
  assert.equal(validateTermCode("a".repeat(33)).ok, false);
  assert.equal(normalizeTermCode(" 2022-2023-1 "), "2022-2023-1");
});

test("normalizeCourse 只映射接口提供的课程字段", () => {
  const course = normalizeCourse(COURSE);
  assert.deepEqual(course, {
    id: "20211170240::YN3004170007::2022-2023-1",
    name: "大学英语听说（4）",
    code: "YN3004170007",
    teacher: "邓杉",
    schedule: "1-18周 星期二 7-8节 格物楼2栋2408",
    termCode: "2022-2023-1",
  });
  assert.equal("score" in course, false);
  assert.equal("credit" in course, false);
  assert.equal("gpa" in course, false);
});

test("normalizeCourse 容忍缺失字段和字面值 null", () => {
  const course = normalizeCourse({ courseTeacher: "null", courseDetailInfo: "null" });
  assert.equal(course.name, "暂无");
  assert.equal(course.code, "暂无");
  assert.equal(course.teacher, "暂无");
  assert.equal(course.schedule, "暂无");
  assert.equal(course.termCode, "");
  assert.equal(course.id, "暂无--0");
});

test("filterCourses 按课程名或教师过滤已加载结果", () => {
  const courses = [
    normalizeCourse(COURSE, 0),
    normalizeCourse({ courseName: "高等数学", courseTeacher: "李明", termCode: "2022-2023-1" }, 1),
  ];
  assert.equal(filterCourses(courses, "").length, 2);
  assert.equal(filterCourses(courses, "   ").length, 2);
  assert.equal(filterCourses(courses, "英语").length, 1);
  assert.equal(filterCourses(courses, "邓杉").length, 1);
  assert.equal(filterCourses(courses, "李明").length, 1);
  assert.equal(filterCourses(courses, "不存在").length, 0);
});

test("requestTermCourses 请求同源代理且不携带 token", async () => {
  let receivedUrl;
  const result = await requestTermCourses({
    termCode: " 2022-2023-1 ",
    endpoint: "/api/term-courses",
    fetchImpl: async (url) => {
      receivedUrl = new URL(url);
      return jsonResponse({ ok: true, data: [COURSE] });
    },
  });

  assert.equal(receivedUrl.pathname, "/api/term-courses");
  assert.equal(receivedUrl.searchParams.get("termCode"), "2022-2023-1");
  assert.equal(receivedUrl.searchParams.has("token"), false);
  assert.equal(receivedUrl.searchParams.has("client"), false);
  assert.equal(result.termCode, "2022-2023-1");
  assert.equal(result.courses.length, 1);
  assert.equal(result.courses[0].teacher, "邓杉");
});

test("requestTermCourses 空列表返回空数组", async () => {
  const result = await requestTermCourses({
    termCode: "2024-2025-2",
    fetchImpl: async () => jsonResponse({ ok: true, data: [] }),
  });
  assert.deepEqual(result.courses, []);
});

test("requestTermCourses 将 401 映射为鉴权失败", async () => {
  await assert.rejects(
    requestTermCourses({
      termCode: "2022-2023-1",
      fetchImpl: async () =>
        jsonResponse(
          { ok: false, error: { code: "AUTH_FAILED", message: "登录凭证已失效，请更新服务端 token 后重试" } },
          401
        ),
    }),
    (error) => {
      assert.ok(error instanceof TermCoursesError);
      assert.equal(error.code, "AUTH_FAILED");
      assert.equal(error.message, "登录凭证已失效，请更新服务端 token 后重试");
      assert.equal(error.retryable, false);
      return true;
    }
  );
});

test("requestTermCourses 将 503 映射为未配置", async () => {
  await assert.rejects(
    requestTermCourses({
      termCode: "2022-2023-1",
      fetchImpl: async () => jsonResponse({ ok: false, error: { code: "NOT_CONFIGURED" } }, 503),
    }),
    (error) => {
      assert.equal(error.code, "NOT_CONFIGURED");
      assert.match(error.message, /WECAMPUS_TOKEN/);
      return true;
    }
  );
});

test("requestTermCourses 将网络异常映射为可重试错误", async () => {
  await assert.rejects(
    requestTermCourses({
      termCode: "2022-2023-1",
      fetchImpl: async () => {
        throw new TypeError("Failed to fetch");
      },
    }),
    (error) => {
      assert.equal(error.code, "NETWORK_ERROR");
      assert.equal(error.retryable, true);
      assert.doesNotMatch(error.message, /Failed to fetch/);
      return true;
    }
  );
});

test("requestTermCourses 将取消失败映射为 ABORTED", async () => {
  await assert.rejects(
    requestTermCourses({
      termCode: "2022-2023-1",
      fetchImpl: async () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        throw error;
      },
    }),
    (error) => {
      assert.equal(error.code, "ABORTED");
      return true;
    }
  );
});

test("requestTermCourses 拒绝非约定响应结构", async () => {
  await assert.rejects(
    requestTermCourses({
      termCode: "2022-2023-1",
      fetchImpl: async () => jsonResponse({ ok: true, data: "not-an-array" }),
    }),
    (error) => {
      assert.equal(error.code, "INVALID_RESPONSE");
      return true;
    }
  );

  await assert.rejects(
    requestTermCourses({
      termCode: "2022-2023-1",
      fetchImpl: async () => jsonResponse({ result: "success", data: [] }),
    }),
    (error) => {
      assert.equal(error.code, "INVALID_RESPONSE");
      return true;
    }
  );
});

test("requestTermCourses 在本地先校验学期代码", async () => {
  let called = false;
  await assert.rejects(
    requestTermCourses({
      termCode: "",
      fetchImpl: async () => {
        called = true;
        return jsonResponse({ ok: true, data: [] });
      },
    }),
    (error) => {
      assert.equal(error.code, "INVALID_TERM_CODE");
      return true;
    }
  );
  assert.equal(called, false);
});
