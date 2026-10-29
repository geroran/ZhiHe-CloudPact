/** 开发网关统一错误信封，不向浏览器返回原始连接错误或内部目标。 */
export function devProxy(target, code, message) {
  return {
    target, changeOrigin: true, timeout: 180000,
    configure(proxy) {
      proxy.on('error', (_error, _req, res) => {
        if (res.headersSent || res.writableEnded || typeof res.writeHead !== 'function') return;
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: false, error: { code, message, retryable: true } }));
      });
    },
  };
}
