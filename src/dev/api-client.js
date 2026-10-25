const API_BASE = '';

export function createDevApi() {
  return {
    async request(path, options = {}) {
      const response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
          Accept: 'application/json',
          ...(options.headers || {}),
        },
      });
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new Error(`服务返回非 JSON 响应（HTTP ${response.status}）`);
      }
      return payload;
    },
  };
}
