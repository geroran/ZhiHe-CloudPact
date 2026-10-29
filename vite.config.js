import { defineConfig, loadEnv } from 'vite';
import { assertFrontendEnv } from './scripts/frontend-env.mjs';

const DREAM_MONITOR_PATHS = [
  '/api/me',
  '/api/login',
  '/api/logout',
  '/api/state',
  '/api/refresh',
  '/api/activity',
];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  assertFrontendEnv(env);
  // 到梦空间模块要求 dream-monitor 与网页同源，HttpOnly Cookie 才能生效。
  // 精确路径必须排在通用 '/api' 之前（对象键顺序即匹配顺序）。
  const dreamTarget = env.DREAM_MONITOR_TARGET || 'http://127.0.0.1:8770';
  const dreamProxy = Object.fromEntries(
    DREAM_MONITOR_PATHS.map((path) => [path, { target: dreamTarget, changeOrigin: true }])
  );
  // 学期课程由主站 Python 服务代理（WECAMPUS_TOKEN 只留在服务端）。
  const termCoursesTarget = env.TERM_COURSES_TARGET || 'http://127.0.0.1:8011';

  return {
    base: './',
    server: {
      host: '127.0.0.1',
      port: 8000,
      proxy: {
        ...dreamProxy,
        '/hiagent': { target: 'https://agent-server.ynu.edu.cn', changeOrigin: true },
        '/api/term-courses': { target: termCoursesTarget, changeOrigin: true },
        '/api/course-grades': { target: termCoursesTarget, changeOrigin: true },
        '/api/agent/': {
          target: env.AGENT_PROXY_TARGET || `http://127.0.0.1:${env.AGENT_PROXY_PORT || 8788}`,
          changeOrigin: true,
          timeout: 180000,
          configure(proxy) {
            proxy.on('error', (_error, _req, res) => {
              if (res.headersSent || res.writableEnded || typeof res.writeHead !== 'function') return;
              res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
              res.end(JSON.stringify({ ok: false, error: {
                code: 'AGENT_PROXY_UNAVAILABLE',
                message: 'AI 代理服务未连接，请启动 npm run api:agent，并检查 AGENT_PROXY_PORT 与 AGENT_PROXY_TARGET 配置。',
                retryable: true,
              } }));
            });
          },
        },
        '^/api/courses$': { target: env.COURSE_API_TARGET || 'http://127.0.0.1:8787', changeOrigin: true },
        '^/api/(health|config|chat|market/(posts|hot|search)|charging/ports|schedule/recognize)$': {
          target: termCoursesTarget, changeOrigin: true, timeout: 180000,
        },
      },
    },
  };
});
