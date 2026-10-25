/**
 * Data access for the teacher/course query module.
 * Only talks to the same-origin /api/courses proxy; the ehall cookie is never
 * available to this code.
 */

const ENDPOINT = "/api/courses";

function clientError(code, message, retryable = true) {
  return Object.assign(new Error(message), { code, retryable });
}

function toQueryString(params) {
  const search = new URLSearchParams();
  search.set("mode", params.mode);
  search.set("keyword", params.keyword);
  search.set("semester", params.semester);
  search.set("page", String(params.page));
  search.set("pageSize", String(params.pageSize));
  return search.toString();
}

function readEnvelope(payload) {
  if (!payload || typeof payload !== "object") {
    throw clientError("BAD_RESPONSE", "服务响应格式不符合约定");
  }
  if (payload.ok !== true) {
    const error = payload.error && typeof payload.error === "object" ? payload.error : {};
    throw clientError(
      typeof error.code === "string" ? error.code : "UNKNOWN_ERROR",
      typeof error.message === "string" && error.message ? error.message : "查询失败",
      error.retryable !== false,
    );
  }
  return payload.data;
}

/**
 * Requests one page from the same-origin proxy. Deliberately ignores any
 * shared API client: the AI client posts to /api/agent/* and must not be used
 * for the course proxy.
 *
 * @param {{ mode: string, keyword: string, semester: string, page: number, pageSize: number }} params
 * @param {{ signal?: AbortSignal, endpoint?: string }} [options]
 */
export async function requestCoursePage(params, options = {}) {
  const endpoint = typeof options.endpoint === "string" && options.endpoint ? options.endpoint : ENDPOINT;
  const path = `${endpoint}?${toQueryString(params)}`;
  let payload;

  try {
    const response = await fetch(path, {
      signal: options.signal,
      headers: { Accept: "application/json" },
    });
    payload = await response.json();
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    if (error && typeof error.code === "string") throw error;
    if (error instanceof SyntaxError) {
      throw clientError("BAD_RESPONSE", "服务返回的不是合法 JSON");
    }
    throw clientError("NETWORK_ERROR", "无法连接本地课程查询服务");
  }

  return readEnvelope(payload);
}
