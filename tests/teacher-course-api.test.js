import test from "node:test";
import assert from "node:assert/strict";
import { requestCoursePage } from "../src/modules/teacher-course-search/api.js";

const PARAMS = {
  mode: "teacher",
  keyword: "杨海燕",
  semester: "2025-2026-2",
  page: 2,
  pageSize: 10,
};

function withFetch(fakeFetch, run) {
  const original = globalThis.fetch;
  globalThis.fetch = fakeFetch;
  return Promise.resolve()
    .then(run)
    .finally(() => {
      globalThis.fetch = original;
    });
}

test("requests the same-origin proxy with the documented query string", async () => {
  let captured = null;
  await withFetch(
    async (url, init) => {
      captured = { url, init };
      return {
        ok: true,
        async json() {
          return { ok: true, data: { source: "live", totalSize: 12, pageNumber: 2, pageSize: 10, rows: [] } };
        },
      };
    },
    async () => {
      const data = await requestCoursePage(PARAMS);
      assert.equal(data.totalSize, 12);
      assert.equal(data.pageNumber, 2);
    },
  );

  assert.equal(captured.init.method, undefined);
  assert.equal(captured.init.headers.Accept, "application/json");
  const url = new URL(captured.url, "http://localhost");
  assert.equal(url.pathname, "/api/courses");
  assert.equal(url.searchParams.get("mode"), "teacher");
  assert.equal(url.searchParams.get("keyword"), "杨海燕");
  assert.equal(url.searchParams.get("semester"), "2025-2026-2");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("pageSize"), "10");
});

test("honours a configured endpoint override", async () => {
  let pathname = "";
  await withFetch(
    async (url) => {
      pathname = new URL(url, "http://localhost").pathname;
      return {
        ok: true,
        async json() {
          return { ok: true, data: { totalSize: 0, rows: [] } };
        },
      };
    },
    async () => {
      await requestCoursePage(PARAMS, { endpoint: "/api/custom-courses" });
    },
  );
  assert.equal(pathname, "/api/custom-courses");
});

test("surfaces the proxy error code and retryable flag", async () => {
  await withFetch(
    async () => ({
      ok: false,
      async json() {
        return {
          ok: false,
          error: { code: "EHALL_SESSION_EXPIRED", message: "教务系统会话已失效", retryable: false },
        };
      },
    }),
    async () => {
      await assert.rejects(
        requestCoursePage(PARAMS),
        (error) => {
          assert.equal(error.code, "EHALL_SESSION_EXPIRED");
          assert.equal(error.retryable, false);
          return true;
        },
      );
    },
  );
});

test("reports non-JSON responses as BAD_RESPONSE", async () => {
  await withFetch(
    async () => ({
      ok: true,
      async json() {
        throw new SyntaxError("Unexpected token <");
      },
    }),
    async () => {
      await assert.rejects(requestCoursePage(PARAMS), (error) => {
        assert.equal(error.code, "BAD_RESPONSE");
        return true;
      });
    },
  );
});

test("reports transport failures as NETWORK_ERROR", async () => {
  await withFetch(
    async () => {
      throw new TypeError("Failed to fetch");
    },
    async () => {
      await assert.rejects(requestCoursePage(PARAMS), (error) => {
        assert.equal(error.code, "NETWORK_ERROR");
        return true;
      });
    },
  );
});

test("passes AbortError through unchanged", async () => {
  await withFetch(
    async () => {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    },
    async () => {
      await assert.rejects(requestCoursePage(PARAMS), (error) => {
        assert.equal(error.name, "AbortError");
        return true;
      });
    },
  );
});
