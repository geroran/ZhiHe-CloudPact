import { fetch as undiciFetch, ProxyAgent } from "undici";

export const UPSTREAM_PATH = "/jwapp/sys/kcbcx/modules/qxkcb/qxfbkccx.do";
export const ORDER = "+KKDWDM,+KCH,+KXH";
export const DEFAULT_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 50;
export const MAX_PAGE = 1000;
export const MAX_KEYWORD_LENGTH = 60;
const SEMESTER_RE = /^\d{4}-\d{4}-[1-3]$/;

const MODE_FIELDS = {
  teacher: { field: "SKJS", caption: "上课教师" },
  course: { field: "KCM", caption: "课程名" },
};

// Only documented/observed fields are exposed. Unknown upstream fields are
// dropped instead of being guessed at or auto-labelled.
const ROW_FIELDS = [
  "KCM",
  "SKJS",
  "YPSJDD",
  "BQDM",
  "BQDM_DISPLAY",
  "XGXKLBDM",
  "XGXKLBDM_DISPLAY",
  "SFXGXK",
  "SFXGXK_DISPLAY",
  "XXXQDM_DISPLAY",
  "KKDWDM_DISPLAY",
  "PKDWDM_DISPLAY",
  "KCH",
  "KXH",
  "SKBJ",
  "XF",
  "XS",
  "SKXS",
  "KNZXS",
  "NSXKRS",
  "KRL",
  "XNXQDM",
  "JXBID",
  "WID",
  "KSJC_DISPLAY",
  "JSJC_DISPLAY",
];

function fail(code, message, retryable = false) {
  return { ok: false, error: { code, message, retryable } };
}

function ok(data) {
  return { ok: true, data };
}

/** Builds the documented querySetting array. Exported for tests. */
export function buildQuerySetting({ field, caption, keyword, semester }) {
  return [
    {
      name: field,
      caption,
      linkOpt: "AND",
      builderList: "cbl_String",
      builder: "include",
      value: keyword,
    },
    [
      { name: "XNXQDM", value: semester, linkOpt: "and", builder: "equal" },
      [
        { name: "RWZTDM", value: "1", linkOpt: "and", builder: "equal" },
        { name: "RWZTDM", linkOpt: "or", builder: "isNull" },
      ],
    ],
    {
      name: "*order",
      value: ORDER,
      linkOpt: "AND",
      builder: "m_value_equal",
    },
  ];
}

/** Builds the exact form body sent upstream. */
export function buildUpstreamForm({ mode, keyword, semester, page, pageSize }) {
  const modeConfig = MODE_FIELDS[mode];
  if (!modeConfig) throw new Error(`Unsupported mode: ${mode}`);
  const params = new URLSearchParams();
  params.set(
    "querySetting",
    JSON.stringify(
      buildQuerySetting({
        field: modeConfig.field,
        caption: modeConfig.caption,
        keyword,
        semester,
      }),
    ),
  );
  params.set("*order", ORDER);
  params.set("SKXQ", "");
  params.set("KSJC", "");
  params.set("JSJC", "");
  params.set("pageSize", String(pageSize));
  params.set("pageNumber", String(page));
  return params;
}

function toInt(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const num = Number(value);
  return Number.isInteger(num) ? num : Number.NaN;
}

/**
 * Validates untrusted query parameters. The frontend may only send mode,
 * keyword, semester, page and pageSize; database field names are never accepted.
 */
export function validateQueryInput(input = {}) {
  const mode = typeof input.mode === "string" ? input.mode.trim() : "";
  if (!Object.hasOwn(MODE_FIELDS, mode)) {
    return fail("INVALID_REQUEST", "mode 必须是 teacher 或 course");
  }

  const keyword = typeof input.keyword === "string" ? input.keyword.trim() : "";
  if (!keyword) return fail("INVALID_REQUEST", "请输入教师姓名或课程名称");
  if (keyword.length > MAX_KEYWORD_LENGTH) {
    return fail("INVALID_REQUEST", `关键词不能超过 ${MAX_KEYWORD_LENGTH} 个字符`);
  }

  const semester = typeof input.semester === "string" ? input.semester.trim() : "";
  if (!SEMESTER_RE.test(semester)) {
    return fail("INVALID_REQUEST", "学期格式应为 2025-2026-2");
  }

  const page = toInt(input.page, 1);
  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) {
    return fail("INVALID_REQUEST", `页码必须是 1–${MAX_PAGE} 之间的整数`);
  }

  const pageSize = toInt(input.pageSize, DEFAULT_PAGE_SIZE);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    return fail("INVALID_REQUEST", `每页条数必须是 1–${MAX_PAGE_SIZE} 之间的整数`);
  }

  return ok({ mode, keyword, semester, page, pageSize });
}

function looksLikeLoginPage(text) {
  if (typeof text !== "string" || text === "") return false;
  const lower = text.toLowerCase();
  if (lower.includes("authserver/login") || lower.includes("cas/login")) return true;
  const looksLikeHtml = /<html|<!doctype html/i.test(text);
  return looksLikeHtml && /(登录|统一身份认证|sign in|log in)/i.test(text);
}

export function normalizeRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    if (!row || typeof row !== "object") return {};
    const picked = {};
    for (const field of ROW_FIELDS) {
      if (Object.hasOwn(row, field)) picked[field] = row[field];
    }
    return picked;
  });
}

export function httpStatusFor(result) {
  if (result?.ok) return 200;
  switch (result?.error?.code) {
    case "INVALID_REQUEST":
      return 400;
    case "EHALL_SESSION_EXPIRED":
      return 401;
    case "EHALL_NOT_CONFIGURED":
      return 503;
    case "EHALL_TIMEOUT":
      return 504;
    case "EHALL_UNAVAILABLE":
    case "EHALL_BAD_RESPONSE":
    case "EHALL_UPSTREAM_ERROR":
      return 502;
    default:
      return 500;
  }
}

/**
 * Service factory. `fetchImpl` exists so tests can point the proxy at a local
 * fake upstream without touching network access.
 */
export function createCoursesService(options = {}) {
  const baseUrl = String(options.baseUrl || "https://ehall.ynu.edu.cn").replace(/\/+$/, "");
  const cookie = typeof options.cookie === "string" ? options.cookie.trim() : "";
  const referer =
    typeof options.referer === "string" && options.referer.trim()
      ? options.referer.trim()
      : `${baseUrl}/jwapp/sys/kcbcx/*default/index.do`;
  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    ? Math.max(1000, Number(options.timeoutMs))
    : 10000;
  const proxyUrl =
    typeof options.proxyUrl === "string" ? options.proxyUrl.trim() : "";
  const origin = (() => {
    try {
      return new URL(baseUrl).origin;
    } catch {
      return "https://ehall.ynu.edu.cn";
    }
  })();

  const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
  const fetchImpl =
    typeof options.fetchImpl === "function"
      ? options.fetchImpl
      : (url, init) => undiciFetch(url, dispatcher ? { ...init, dispatcher } : init);

  async function query(input) {
    const validated = validateQueryInput(input);
    if (!validated.ok) return validated;
    const { mode, keyword, semester, page, pageSize } = validated.data;

    if (!cookie) {
      return fail(
        "EHALL_NOT_CONFIGURED",
        "服务端未配置教务会话，请在服务端环境变量中设置后重试",
      );
    }

    const form = buildUpstreamForm({ mode, keyword, semester, page, pageSize });
    const headers = {
      Accept: "application/json, text/javascript, */*; q=0.01",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Origin: origin,
      Referer: referer,
      Cookie: cookie,
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    };

    const signal = AbortSignal.timeout(timeoutMs);
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${UPSTREAM_PATH}`, {
        method: "POST",
        headers,
        body: form.toString(),
        redirect: "manual",
        signal,
      });
    } catch (error) {
      if (signal.aborted) {
        return fail("EHALL_TIMEOUT", "教务系统响应超时", true);
      }
      return fail("EHALL_UNAVAILABLE", "无法连接教务系统", true);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      return fail("EHALL_SESSION_EXPIRED", "教务系统会话已失效，需要更新服务端会话");
    }
    if (response.status === 401 || response.status === 403) {
      return fail("EHALL_SESSION_EXPIRED", "教务系统会话已失效，需要更新服务端会话");
    }

    let text;
    try {
      text = await response.text();
    } catch {
      return fail("EHALL_TIMEOUT", "读取教务系统响应超时", true);
    }

    if (!response.ok) {
      if (looksLikeLoginPage(text)) {
        return fail("EHALL_SESSION_EXPIRED", "教务系统会话已失效，需要更新服务端会话");
      }
      return fail(
        "EHALL_UPSTREAM_ERROR",
        `教务系统返回 HTTP ${response.status}`,
        response.status >= 500,
      );
    }

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      if (looksLikeLoginPage(text)) {
        return fail("EHALL_SESSION_EXPIRED", "教务系统会话已失效，需要更新服务端会话");
      }
      return fail("EHALL_BAD_RESPONSE", "教务系统返回的不是合法 JSON", true);
    }

    const result = payload?.datas?.qxfbkccx;
    if (!result || !Array.isArray(result.rows)) {
      if (looksLikeLoginPage(text)) {
        return fail("EHALL_SESSION_EXPIRED", "教务系统会话已失效，需要更新服务端会话");
      }
      return fail("EHALL_BAD_RESPONSE", "教务系统响应结构不符合预期", true);
    }

    const totalSize = Number(result.totalSize);
    if (!Number.isFinite(totalSize) || totalSize < 0) {
      return fail("EHALL_BAD_RESPONSE", "教务系统响应缺少有效 totalSize", true);
    }

    const upstreamPage = Number(result.pageNumber);
    const upstreamPageSize = Number(result.pageSize);

    return ok({
      source: "live",
      totalSize,
      pageNumber: Number.isFinite(upstreamPage) && upstreamPage >= 1 ? upstreamPage : page,
      pageSize:
        Number.isFinite(upstreamPageSize) && upstreamPageSize >= 1
          ? upstreamPageSize
          : pageSize,
      rows: normalizeRows(result.rows),
    });
  }

  return {
    query,
    close() {
      if (dispatcher) dispatcher.close().catch(() => {});
    },
  };
}

/**
 * Framework-agnostic Node request handler. Express-style req/res objects also
 * satisfy this shape, so the main server can mount it without changes.
 */
export function createCoursesHandler(service) {
  return async function handleCoursesRequest(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.setHeader("Allow", "GET, OPTIONS");
      res.end();
      return;
    }
    if (req.method !== "GET") {
      res.statusCode = 405;
      res.setHeader("Allow", "GET, OPTIONS");
      res.end(JSON.stringify(fail("METHOD_NOT_ALLOWED", "仅支持 GET 请求")));
      return;
    }

    let url;
    try {
      url = new URL(req.url || "/", "http://localhost");
    } catch {
      res.statusCode = 400;
      res.end(JSON.stringify(fail("INVALID_REQUEST", "请求地址不合法")));
      return;
    }

    const params = Object.fromEntries(url.searchParams.entries());
    let result;
    try {
      result = await service.query(params);
    } catch {
      result = fail("INTERNAL_ERROR", "服务处理查询时发生错误", true);
    }

    res.statusCode = httpStatusFor(result);
    res.end(JSON.stringify(result));
  };
}
