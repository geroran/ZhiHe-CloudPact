/**
 * 校园集市 Agent 的独立联调配置。
 *
 * 不修改主站共享的 vite.config.js，避免与其它模块的代理规则互相覆盖；
 * `/api` 统一代理到本模块的 Python 服务（默认 127.0.0.1:8011）。
 *
 * 启动：npm run dev:market
 */
import { defineConfig, loadEnv } from 'vite';
import { assertFrontendEnv } from '../../scripts/frontend-env.mjs';

export default defineConfig(({ mode }) => {
  assertFrontendEnv(loadEnv(mode, process.cwd(), ''));
  return {
  server: {
    host: '127.0.0.1',
    port: 5300,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.MARKET_AGENT_API_TARGET || 'http://127.0.0.1:8011',
        changeOrigin: true,
      },
    },
  },
  };
});
