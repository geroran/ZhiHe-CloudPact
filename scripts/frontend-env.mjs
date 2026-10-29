const FORBIDDEN = ['VITE_AGENT_APP_ID', 'VITE_AGENT_API_KEY'];

// Vite 在开发和构建时都会暴露 VITE_ 变量，必须在加载项目之前拒绝凭据。
export function assertFrontendEnv(env) {
  const configured = FORBIDDEN.filter((key) => String(env[key] || '').trim());
  if (configured.length) {
    throw new Error(`前端配置禁止包含凭据：${configured.join('、')}。请迁移到服务端 AGENT_APP_ID / AGENT_API_KEY。`);
  }
  if (env.VITE_AGENT_TRANSPORT && env.VITE_AGENT_TRANSPORT !== 'proxy') {
    throw new Error('VITE_AGENT_TRANSPORT 仅支持 proxy，请更新旧的 direct 配置。');
  }
}
