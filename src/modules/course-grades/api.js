/**
 * 课程给分情况的数据适配层。
 *
 * 浏览器只请求同源代理 `/api/course-grades/search|info`，
 * Wecampus JWT 由主站服务端注入，不会出现在浏览器请求体、URL 或控制台中。
 */

export const SEARCH_ENDPOINT = "/api/course-grades/search";
export const INFO_ENDPOINT = "/api/course-grades/info";
export const PAGE_SIZE = 15;
export const MAX_TEXT_LENGTH = 80;

export class CourseGradesError extends Error {
  constructor(code, message, { status = 0, retryable = false } = {}) {
    super(message);
    this.name = "CourseGradesError";
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export function normalizeText(value) {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  return text.toLowerCase() === "null" ? "" : text;
}

export function displayValue(value, fallback = "暂无") {
  const text = normalizeText(value);
  return text === "" ? fallback : text;
}

/**
 * 检索至少需要课程名或教师之一。
 */
export function validateQuery({ courseName = "", teacher = "" } = {}) {
  const name = normalizeText(courseName);
  const tutor = normalizeText(teacher);
  if (!name && !tutor) {
    return { ok: false, message: "请至少填写课程名或教师" };
  }
  if (name.length > MAX_TEXT_LENGTH || tutor.length > MAX_TEXT_LENGTH) {
    return { ok: false, message: `课程名或教师不能超过 ${MAX_TEXT_LENGTH} 个字符` };
  }
  return { ok: true, courseName: name, teacher: tutor };
}

export function normalizeSearchResults(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const results = [];
  for (const item of list) {
    const source = item && typeof item === "object" ? item : {};
    const courseName = normalizeText(source.courseName);
    const courseTeacher = normalizeText(source.courseTeacher);
    if (!courseName) continue;
    const key = `${courseName}::${courseTeacher}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ key, courseName, courseTeacher });
  }
  return results;
}

function toNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * 给分字段只保留数值；count 为 0 或缺失视为没有可用样本。
 */
export function normalizeGrade(raw) {
  if (!raw || typeof raw !== "object") return null;
  const count = toNumber(raw.count);
  if (!count || count <= 0) return null;

  return {
    count,
    avg: toNumber(raw.avg),
    maxScore: toNumber(raw.maxScore),
    u90: toNumber(raw.u90),
    b8090: toNumber(raw.b8090),
    b7080: toNumber(raw.b7080),
    b6070: toNumber(raw.b6070),
    d60: toNumber(raw.d60),
    usualAvg: toNumber(raw.usualAvg),
    midtermAvg: toNumber(raw.midtermAvg),
    finalAvg: toNumber(raw.finalAvg),
  };
}

function proxyMessage(payload, fallback) {
  const message = payload?.error?.message;
  return typeof message === "string" && message.trim() ? message.trim() : fallback;
}

function errorForStatus(status, payload) {
  if (status === 400) {
    return new CourseGradesError("INVALID_REQUEST", proxyMessage(payload, "查询参数不正确，请检查后重试"));
  }
  if (status === 401 || status === 403) {
    return new CourseGradesError(
      "AUTH_FAILED",
      proxyMessage(payload, "登录凭证已失效，请更新服务端 token 后重试")
    );
  }
  if (status === 503) {
    return new CourseGradesError(
      "NOT_CONFIGURED",
      proxyMessage(payload, "服务端未配置课程查询凭证（WECAMPUS_TOKEN）")
    );
  }
  if (status === 504) {
    return new CourseGradesError(
      "UPSTREAM_TIMEOUT",
      proxyMessage(payload, "课程接口响应超时，请稍后重试"),
      { status, retryable: true }
    );
  }
  if (status >= 500) {
    return new CourseGradesError(
      "UPSTREAM_ERROR",
      proxyMessage(payload, "课程服务暂时不可用，请稍后重试"),
      { status, retryable: true }
    );
  }
  return new CourseGradesError(
    "HTTP_ERROR",
    proxyMessage(payload, `课程服务返回错误（HTTP ${status}）`),
    { status, retryable: true }
  );
}

async function postJson({ endpoint, body, fetchImpl, signal, fallbackUrl }) {
  if (typeof fetchImpl !== "function") {
    throw new CourseGradesError("NETWORK_ERROR", "当前环境不支持网络请求");
  }

  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new CourseGradesError("ABORTED", "请求已取消");
    }
    throw new CourseGradesError(
      "NETWORK_ERROR",
      `无法连接${fallbackUrl}，请检查网络或后端代理配置`,
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
  if (!payload || payload.ok !== true) {
    throw new CourseGradesError(
      "INVALID_RESPONSE",
      "课程服务返回数据格式异常，请稍后重试",
      { status: response.status, retryable: true }
    );
  }
  return payload.data;
}

/**
 * 按课程名和/或教师检索课程。
 *
 * @returns {Promise<{page: number, courses: Array<{key: string, courseName: string, courseTeacher: string}>}>}
 */
export async function requestCourseSearch({
  courseName = "",
  teacher = "",
  page = 1,
  endpoint = SEARCH_ENDPOINT,
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  const validation = validateQuery({ courseName, teacher });
  if (!validation.ok) {
    throw new CourseGradesError("INVALID_REQUEST", validation.message, { status: 400 });
  }
  const pageNumber = Number.isInteger(page) && page >= 1 ? page : 1;

  const data = await postJson({
    endpoint,
    body: {
      courseName: validation.courseName,
      teacher: validation.teacher,
      page: pageNumber,
    },
    fetchImpl,
    signal,
    fallbackUrl: "课程检索服务",
  });

  if (!Array.isArray(data)) {
    throw new CourseGradesError(
      "INVALID_RESPONSE",
      "课程服务返回数据格式异常，请稍后重试",
      { retryable: true }
    );
  }
  return { page: pageNumber, courses: normalizeSearchResults(data) };
}

/**
 * 查询一门课程的历史给分统计；无样本时返回 null。
 */
export async function requestCourseGrade({
  courseName,
  teacher = "",
  endpoint = INFO_ENDPOINT,
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  const name = normalizeText(courseName);
  if (!name) {
    throw new CourseGradesError("INVALID_REQUEST", "缺少课程名", { status: 400 });
  }

  const data = await postJson({
    endpoint,
    body: { courseName: name, teacher: normalizeText(teacher) },
    fetchImpl,
    signal,
    fallbackUrl: "课程给分服务",
  });

  if (data === null) return null;
  const grade = normalizeGrade(data);
  if (!grade) {
    throw new CourseGradesError(
      "INVALID_RESPONSE",
      "给分数据格式异常，请稍后重试",
      { retryable: true }
    );
  }
  return grade;
}
