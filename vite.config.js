import { defineConfig, loadEnv } from 'vite';
import { assertFrontendEnv } from './scripts/frontend-env.mjs';
import { devProxy } from './scripts/dev-proxy.mjs';

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
  // 各模块分别转发到对应后端，不使用通用 /api 兜底。
  const dreamTarget = env.DREAM_MONITOR_TARGET || 'http://127.0.0.1:8770';
  const dreamProxy = Object.fromEntries(
    DREAM_MONITOR_PATHS.map((path) => [path, devProxy(dreamTarget, 'DREAM_PROXY_UNAVAILABLE', '活动服务未连接，请启动 npm run dev:dream-monitor。')])
  );
  // 学期课程由主站 Python 服务代理（WECAMPUS_TOKEN 只留在服务端）。
  const termCoursesTarget = env.TERM_COURSES_TARGET || 'http://127.0.0.1:8011';

  const mainProxy = devProxy(termCoursesTarget, 'MAIN_API_UNAVAILABLE', '主站服务未连接，请启动 npm run dev:server，并检查 TERM_COURSES_TARGET 配置。');

  return {
    base: './',
    server: {
      host: '127.0.0.1',
      port: 8000,
      proxy: {
        ...dreamProxy,
        '/hiagent': devProxy('https://agent-server.ynu.edu.cn', 'CLASSROOM_PROXY_UNAVAILABLE', '空教室服务暂时无法连接，请稍后重试。'),
        '/api/term-courses': mainProxy,
        '/api/course-grades': mainProxy,
        '/api/agent/': devProxy(
          env.AGENT_PROXY_TARGET || `http://127.0.0.1:${env.AGENT_PROXY_PORT || 8788}`,
          'AGENT_PROXY_UNAVAILABLE',
          'AI 代理服务未连接，请启动 npm run api:agent，并检查 AGENT_PROXY_PORT 与 AGENT_PROXY_TARGET 配置。',
        ),
        '^/api/courses$': devProxy(env.COURSE_API_TARGET || 'http://127.0.0.1:8787', 'COURSE_PROXY_UNAVAILABLE', '课程服务未连接，请启动 npm run api:courses。'),
        '^/api/(health|config|chat|market/(posts|hot|search)|charging/ports|schedule/recognize)$': mainProxy,
      },
    },
  };
});
