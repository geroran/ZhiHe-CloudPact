/**
 * 学期课程列表的数据适配层。
 *
 * 浏览器只请求同源代理 `/api/term-courses?termCode=...`，Wecampus JWT 由代理在
 * 服务端注入，不会出现在浏览器请求 URL、构建产物或控制台中。
 */

export const DEFAULT_ENDPOINT = "/api/term-courses";
export const MAX_TERM_CODE_LENGTH = 32;

const TERM_CODE_PATTERN = /^[A-Za-z0-9_-]+$/;

export class TermCoursesError extends Error {
  constructor(code, message, { status = 0, retryable = false } = {}) {
    super(message);
    this.name = "TermCoursesError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export function normalizeTermCode(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function validateTermCode(value) {
  const termCode = normalizeTermCode(value);
  if (!termCode) {
    return { ok: false, message: "请输入学期代码" };
  }
  if (termCode.length > MAX_TERM_CODE_LENGTH || !TERM_CODE_PATTERN.test(termCode)) {
    return { ok: false, message: "学期代码格式不正确，请检查后重试" };
  }
  return { ok: true, termCode };
}

/**
 * 接口返回的字面值 "null"、空字符串与缺字段统一显示为“暂无”。
 */
export function displayValue(value, fallback = "暂无") {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text === "" || text === "null" ? fallback : text;
}

export function normalizeCourse(course, index = 0) {
  const source = course && typeof course === "object" ? course : {};
  const name = displayValue(source.courseName);
  const code = displayValue(source.courseId);
  const teacher = displayValue(source.courseTeacher);
  const schedule = displayValue(source.courseDetailInfo);
  const termCode = displayValue(source.termCode, "");
  const id = displayValue(source.id, "") || `${code}-${termCode}-${index}`;

  return { id, name, code, teacher, schedule, termCode };
}

export function normalizeCourses(list) {
  return list.map((course, index) => normalizeCourse(course, index));
}

/** 仅过滤已加载结果，不触发新请求。 */
export function filterCourses(courses, keyword) {
  const query = typeof keyword === "string" ? keyword.trim().toLowerCase() : "";
  if (!query) return courses;
  return courses.filter((course) =>
    `${course.name} ${course.teacher}`.toLowerCase().includes(query)
  );
}

function proxyMessage(payload, fallback) {
  const message = payload?.error?.message;
  return typeof message === "string" && message.trim() ? message.trim() : fallback;
}

function errorForStatus(status, payload) {
  if (status === 400) {
    return new TermCoursesError(
      "INVALID_TERM_CODE",
      proxyMessage(payload, "学期代码格式不正确，请检查后重试"),
      { status, retryable: false }
    );
  }
  if (status === 401 || status === 403) {
    return new TermCoursesError(
      "AUTH_FAILED",
      proxyMessage(payload, "登录凭证已失效，请更新服务端 token 后重试"),
      { status, retryable: false }
    );
  }
  if (status === 503) {
    return new TermCoursesError(
      "NOT_CONFIGURED",
      proxyMessage(payload, "服务端未配置课程查询凭证（WECAMPUS_TOKEN）"),
      { status, retryable: false }
    );
  }
  if (status === 504) {
    return new TermCoursesError(
      "UPSTREAM_TIMEOUT",
      proxyMessage(payload, "课程接口响应超时，请稍后重试"),
      { status, retryable: true }
    );
  }
  if (status >= 500) {
    return new TermCoursesError(
      "UPSTREAM_ERROR",
      proxyMessage(payload, "课程服务暂时不可用，请稍后重试"),
      { status, retryable: true }
    );
  }
  return new TermCoursesError(
    "HTTP_ERROR",
    proxyMessage(payload, `课程服务返回错误（HTTP ${status}）`),
    { status, retryable: true }
  );
}

/**
 * 通过同源代理请求课程列表。
 *
 * @param {object} options
 * @param {string} options.termCode 学期代码，必填。
 * @param {string} [options.endpoint] 代理地址，默认 `/api/term-courses`。
 * @param {typeof fetch} [options.fetchImpl] 便于测试注入。
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{termCode: string, courses: ReturnType<typeof normalizeCourses>}>}
 */
export async function requestTermCourses({
  termCode,
  endpoint = DEFAULT_ENDPOINT,
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  const validation = validateTermCode(termCode);
  if (!validation.ok) {
    throw new TermCoursesError("INVALID_TERM_CODE", validation.message, { status: 400 });
  }
  if (typeof fetchImpl !== "function") {
    throw new TermCoursesError("NETWORK_ERROR", "当前环境不支持网络请求", { retryable: false });
  }

  const base =
    typeof globalThis.location !== "undefined" && globalThis.location.origin
      ? globalThis.location.origin
      : "http://localhost";
  let url;
  try {
    const target = new URL(endpoint, base);
    target.searchParams.set("termCode", validation.termCode);
    url = target.toString();
  } catch {
    throw new TermCoursesError("CONFIG_ERROR", "课程接口地址配置不正确", { retryable: false });
  }

  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new TermCoursesError("ABORTED", "请求已取消", { retryable: false });
    }
    throw new TermCoursesError(
      "NETWORK_ERROR",
      "课程加载失败，请检查网络或后端代理配置",
      { retryable: true }
    );
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw errorForStatus(response.status, payload);
  }
  if (!payload || payload.ok !== true || !Array.isArray(payload.data)) {
    throw new TermCoursesError(
      "INVALID_RESPONSE",
      "课程服务返回数据格式异常，请稍后重试",
      { status: response.status, retryable: true }
    );
  }

  return {
    termCode: validation.termCode,
    courses: normalizeCourses(payload.data),
  };
}
