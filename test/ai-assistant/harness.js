import { createApiClient } from '/src/shared/api.js';
import { readRuntimeConfig } from '/src/shared/config.js';
import { mountAiAssistant } from '/src/modules/ai-assistant/index.js';

const root = document.getElementById('app');
const result = readRuntimeConfig();

if (!result.ok) {
  root.textContent = result.error.message;
  window.__harness = { ok: false, error: result.error };
} else {
  const api = createApiClient(result.data);
  const unmount = mountAiAssistant(root, {
    api,
    config: result.data,
    notify: () => {},
    navigate: () => {}
  });
  window.__harness = { ok: true, config: result.data, unmount };
}
