import http from "node:http";
import { loadEnvFiles } from "./lib/env.js";
import { createCoursesHandler, createCoursesService } from "./routes/courses.js";

loadEnvFiles(process.cwd());

const host = process.env.COURSE_API_HOST || "127.0.0.1";
const port = Number(process.env.COURSE_API_PORT || 8787);

const service = createCoursesService({
  baseUrl: process.env.EHALL_BASE_URL || "https://ehall.ynu.edu.cn",
  cookie: process.env.EHALL_COOKIE || "",
  referer: process.env.EHALL_REFERER || "",
  timeoutMs: Number(process.env.EHALL_TIMEOUT_MS || 10000),
  // Optional local proxy (for example a Clash port). No credentials are logged.
  proxyUrl: process.env.EHALL_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "",
});

const handleCourses = createCoursesHandler(service);

const server = http.createServer(async (req, res) => {
  const startedAt = Date.now();
  let pathname = "/";
  try {
    pathname = new URL(req.url || "/", "http://localhost").pathname;
  } catch {
    pathname = "/invalid";
  }

  if (pathname === "/api/courses") {
    await handleCourses(req, res);
  } else {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(
      JSON.stringify({
        ok: false,
        error: { code: "NOT_FOUND", message: "接口不存在", retryable: false },
      }),
    );
  }

  // Never log query strings, cookies, headers, or upstream bodies.
  console.log(`${req.method} ${pathname} ${res.statusCode} ${Date.now() - startedAt}ms`);
});

server.listen(port, host, () => {
  console.log(`course API listening on http://${host}:${port}`);
  console.log(`ehall session configured: ${process.env.EHALL_COOKIE ? "yes" : "no"}`);
});

function shutdown() {
  service.close();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
