import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  ORDER,
  UPSTREAM_PATH,
  buildQuerySetting,
  buildUpstreamForm,
  createCoursesHandler,
  createCoursesService,
  httpStatusFor,
  normalizeRows,
  validateQueryInput,
} from "../server/routes/courses.js";

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Starts a local fake upstream so tests never touch the real ehall service. */
function startUpstream(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function jsonResponse(res, payload, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

const VALID_QUERY = {
  mode: "teacher",
  keyword: "杨海燕",
  semester: "2025-2026-2",
  page: 1,
  pageSize: 10,
};

const SAMPLE_UPSTREAM_ROWS = [
  {
    KCM: "计算地球物理基础",
    SKJS: "杨海燕",
    YPSJDD: "3-18周 星期四 3-4节 力行楼4307",
    BQDM: "01",
    BQDM_DISPLAY: "理论课",
    XGXKLBDM: null,
    XGXKLBDM_DISPLAY: "",
    KCH: "YN253035140015",
    KXH: "01",
    JXBID: "jx-1",
    XF: 2,
    NSXKRS: 30,
    KRL: 60,
    INTERNAL_SECRET: "should-not-leak",
  },
  {
    KCM: "地震与地震预警",
    SKJS: "杨海燕,李明",
    YPSJDD: "4-18周 星期五 5-6节 格物楼4栋4108,4-9周 星期一 5-6节 格物楼4栋4410",
    BQDM: "02",
    BQDM_DISPLAY: "实验课",
    XGXKLBDM: 33,
    XGXKLBDM_DISPLAY: "自然科学",
    KCH: "YN253035140016",
    KXH: "02",
    JXBID: "jx-2",
  },
];

test("buildQuerySetting uses SKJS/KCM, semester, task status and order", () => {
  const setting = buildQuerySetting({
    field: "SKJS",
    caption: "上课教师",
    keyword: "杨海燕",
    semester: "2025-2026-2",
  });
  assert.equal(setting[0].name, "SKJS");
  assert.equal(setting[0].caption, "上课教师");
  assert.equal(setting[0].builder, "include");
  assert.equal(setting[0].value, "杨海燕");
  assert.equal(setting[1][0].name, "XNXQDM");
  assert.equal(setting[1][0].value, "2025-2026-2");
  assert.equal(setting[1][1][0].name, "RWZTDM");
  assert.equal(setting[1][1][0].value, "1");
  assert.equal(setting[1][1][1].builder, "isNull");
  assert.equal(setting[2].name, "*order");
  assert.equal(setting[2].value, ORDER);
  assert.equal(ORDER, "+KKDWDM,+KCH,+KXH");
});

test("buildUpstreamForm keeps all documented form fields", () => {
  const form = buildUpstreamForm({ ...VALID_QUERY, page: 2, pageSize: 20 });
  assert.equal(form.get("*order"), ORDER);
  assert.equal(form.get("SKXQ"), "");
  assert.equal(form.get("KSJC"), "");
  assert.equal(form.get("JSJC"), "");
  assert.equal(form.get("pageNumber"), "2");
  assert.equal(form.get("pageSize"), "20");
  const setting = JSON.parse(form.get("querySetting"));
  assert.equal(setting[0].name, "SKJS");
});

test("validates mode, keyword, semester and pagination", () => {
  assert.equal(validateQueryInput(VALID_QUERY).ok, true);

  const invalid = [
    { ...VALID_QUERY, mode: "admin" },
    { ...VALID_QUERY, keyword: "" },
    { ...VALID_QUERY, keyword: "   " },
    { ...VALID_QUERY, semester: "2025-2026" },
    { ...VALID_QUERY, page: 0 },
    { ...VALID_QUERY, page: "x" },
    { ...VALID_QUERY, pageSize: 0 },
    { ...VALID_QUERY, pageSize: 51 },
  ];
  for (const input of invalid) {
    const result = validateQueryInput(input);
    assert.equal(result.ok, false, JSON.stringify(input));
    assert.equal(result.error.code, "INVALID_REQUEST");
    assert.equal(httpStatusFor(result), 400);
  }
});

test("normalizeRows keeps only documented fields", () => {
  const rows = normalizeRows(SAMPLE_UPSTREAM_ROWS);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].KCM, "计算地球物理基础");
  assert.equal(rows[0].XGXKLBDM_DISPLAY, "");
  assert.equal(rows[0].INTERNAL_SECRET, undefined);
  assert.equal(rows[1].XGXKLBDM_DISPLAY, "自然科学");
});

test("teacher query sends the captured protocol and returns a live envelope", async () => {
  let captured = null;
  const upstream = await startUpstream(async (req, res) => {
    captured = {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: await readBody(req),
    };
    jsonResponse(res, {
      datas: {
        qxfbkccx: {
          totalSize: 4,
          pageNumber: 1,
          pageSize: 10,
          rows: SAMPLE_UPSTREAM_ROWS,
        },
      },
    });
  });

  try {
    const cookie = "route=abc; JSESSIONID=def";
    const service = createCoursesService({
      baseUrl: upstream.url,
      cookie,
      timeoutMs: 2000,
    });
    const result = await service.query(VALID_QUERY);

    assert.equal(result.ok, true);
    assert.equal(result.data.source, "live");
    assert.equal(result.data.totalSize, 4);
    assert.equal(result.data.pageNumber, 1);
    assert.equal(result.data.pageSize, 10);
    assert.equal(result.data.rows.length, 2);
    assert.equal(result.data.rows[0].KCM, "计算地球物理基础");
    assert.equal(result.data.rows[1].KXH, "02");
    assert.equal(result.data.rows[0].INTERNAL_SECRET, undefined);

    assert.equal(captured.method, "POST");
    assert.equal(captured.url, UPSTREAM_PATH);
    assert.equal(captured.headers.cookie, cookie);
    assert.equal(captured.headers.origin, upstream.url);
    assert.match(captured.headers.referer, /\/jwapp\/sys\/kcbcx\/\*default\/index\.do$/);
    assert.match(captured.headers["content-type"], /application\/x-www-form-urlencoded/);
    assert.equal(captured.headers["x-requested-with"], "XMLHttpRequest");

    const form = new URLSearchParams(captured.body);
    assert.equal(form.get("pageNumber"), "1");
    assert.equal(form.get("pageSize"), "10");
    assert.equal(form.get("*order"), ORDER);
    const setting = JSON.parse(form.get("querySetting"));
    assert.equal(setting[0].name, "SKJS");
    assert.equal(setting[0].value, "杨海燕");
    assert.equal(setting[1][0].value, "2025-2026-2");

    const serialised = JSON.stringify(result);
    assert.equal(serialised.includes(cookie), false);

    service.close();
  } finally {
    await upstream.close();
  }
});

test("course mode maps to KCM and respects the upstream page number", async () => {
  let form = null;
  const upstream = await startUpstream(async (req, res) => {
    form = new URLSearchParams(await readBody(req));
    jsonResponse(res, {
      datas: {
        qxfbkccx: {
          totalSize: 5,
          pageNumber: 2,
          pageSize: 10,
          rows: [{ KCM: "非洲文学的历史景象", KXH: "01" }],
        },
      },
    });
  });

  try {
    const service = createCoursesService({
      baseUrl: upstream.url,
      cookie: "a=b",
      timeoutMs: 2000,
    });
    const result = await service.query({
      mode: "course",
      keyword: "非洲",
      semester: "2025-2026-2",
      page: 1,
      pageSize: 10,
    });

    assert.equal(result.ok, true);
    assert.equal(result.data.pageNumber, 2);
    assert.equal(result.data.totalSize, 5);
    const setting = JSON.parse(form.get("querySetting"));
    assert.equal(setting[0].name, "KCM");
    assert.equal(setting[0].caption, "课程名");
    assert.equal(setting[0].value, "非洲");

    service.close();
  } finally {
    await upstream.close();
  }
});

test("redirects and login pages are reported as an expired session", async () => {
  const redirectUpstream = await startUpstream((req, res) => {
    res.writeHead(302, { Location: "https://ids.ynu.edu.cn/authserver/login" });
    res.end("<html><body>302</body></html>");
  });
  try {
    const service = createCoursesService({
      baseUrl: redirectUpstream.url,
      cookie: "a=b",
      timeoutMs: 2000,
    });
    const result = await service.query(VALID_QUERY);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "EHALL_SESSION_EXPIRED");
    assert.equal(httpStatusFor(result), 401);
    assert.equal(JSON.stringify(result).includes("authserver"), false);
    service.close();
  } finally {
    await redirectUpstream.close();
  }

  const loginUpstream = await startUpstream((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<html><title>统一身份认证登录</title><body>请登录</body></html>");
  });
  try {
    const service = createCoursesService({
      baseUrl: loginUpstream.url,
      cookie: "a=b",
      timeoutMs: 2000,
    });
    const result = await service.query(VALID_QUERY);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "EHALL_SESSION_EXPIRED");
    service.close();
  } finally {
    await loginUpstream.close();
  }
});

test("upstream HTTP errors and malformed payloads use stable error codes", async () => {
  const upstream = await startUpstream(async (req, res) => {
    await readBody(req);
    jsonResponse(res, { error: "boom" }, 500);
  });
  try {
    const service = createCoursesService({
      baseUrl: upstream.url,
      cookie: "a=b",
      timeoutMs: 2000,
    });
    const result = await service.query(VALID_QUERY);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "EHALL_UPSTREAM_ERROR");
    assert.equal(result.error.retryable, true);
    assert.equal(httpStatusFor(result), 502);
    service.close();
  } finally {
    await upstream.close();
  }

  const weird = await startUpstream((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("{not-json");
  });
  try {
    const service = createCoursesService({
      baseUrl: weird.url,
      cookie: "a=b",
      timeoutMs: 2000,
    });
    const result = await service.query(VALID_QUERY);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "EHALL_BAD_RESPONSE");
    service.close();
  } finally {
    await weird.close();
  }

  const missing = await startUpstream((req, res) => {
    jsonResponse(res, { datas: {} });
  });
  try {
    const service = createCoursesService({
      baseUrl: missing.url,
      cookie: "a=b",
      timeoutMs: 2000,
    });
    const result = await service.query(VALID_QUERY);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "EHALL_BAD_RESPONSE");
    service.close();
  } finally {
    await missing.close();
  }
});

test("a missing server-side session is reported without calling upstream", async () => {
  let called = false;
  const upstream = await startUpstream((req, res) => {
    called = true;
    jsonResponse(res, {});
  });
  try {
    const service = createCoursesService({
      baseUrl: upstream.url,
      cookie: "",
      timeoutMs: 2000,
    });
    const result = await service.query(VALID_QUERY);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "EHALL_NOT_CONFIGURED");
    assert.equal(httpStatusFor(result), 503);
    assert.equal(called, false);
    service.close();
  } finally {
    await upstream.close();
  }
});

test("an upstream timeout is reported as retryable", async () => {
  const upstream = await startUpstream(async (req, res) => {
    await readBody(req);
    setTimeout(() => jsonResponse(res, { datas: { qxfbkccx: { rows: [], totalSize: 0 } } }), 1500);
  });
  try {
    const service = createCoursesService({
      baseUrl: upstream.url,
      cookie: "a=b",
      timeoutMs: 1000,
    });
    const startedAt = Date.now();
    const result = await service.query(VALID_QUERY);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "EHALL_TIMEOUT");
    assert.equal(result.error.retryable, true);
    assert.equal(httpStatusFor(result), 504);
    assert.ok(Date.now() - startedAt < 3000);
    service.close();
  } finally {
    await upstream.close();
  }
});

test("HTTP handler returns the unified envelope, no-store headers and stable statuses", async () => {
  const upstream = await startUpstream(async (req, res) => {
    await readBody(req);
    jsonResponse(res, {
      datas: { qxfbkccx: { totalSize: 0, pageNumber: 1, pageSize: 10, rows: [] } },
    });
  });

  const service = createCoursesService({
    baseUrl: upstream.url,
    cookie: "a=b",
    timeoutMs: 2000,
  });
  const api = http.createServer(createCoursesHandler(service));
  await new Promise((done) => api.listen(0, "127.0.0.1", done));
  const { port } = api.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    const good = await fetch(
      `${base}/api/courses?mode=teacher&keyword=${encodeURIComponent("杨海燕")}&semester=2025-2026-2&page=1&pageSize=10`,
    );
    assert.equal(good.status, 200);
    assert.equal(good.headers.get("cache-control"), "no-store");
    const body = await good.json();
    assert.equal(body.ok, true);
    assert.equal(body.data.totalSize, 0);

    const bad = await fetch(`${base}/api/courses?mode=nope&keyword=x&semester=2025-2026-2`);
    assert.equal(bad.status, 400);
    const badBody = await bad.json();
    assert.equal(badBody.ok, false);
    assert.equal(badBody.error.code, "INVALID_REQUEST");

    const post = await fetch(`${base}/api/courses`, { method: "POST" });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get("allow"), "GET, OPTIONS");
  } finally {
    await new Promise((done) => api.close(done));
    await upstream.close();
    service.close();
  }
});
