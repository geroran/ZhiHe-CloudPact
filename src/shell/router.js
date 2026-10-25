import { findModule } from '../modules/registry.js';
import { createSameOriginClient } from '../shared/api.js';
import { readRuntimeConfig } from '../shared/config.js';
import { notify } from '../shared/notify.js';
import { renderHome } from './home.js';
import { renderPlaceholder } from './placeholder.js';

const backIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>';

function currentPath() {
  const raw = location.hash.replace(/^#/, '');
  if (!raw) return '/';
  try {
    const decoded = decodeURIComponent(raw);
    return decoded.startsWith('/') ? decoded : `/${decoded}`;
  } catch {
    return '/';
  }
}

function renderNotFound(root, { navigate }) {
  document.title = '页面不存在 · 智启云聚';
  root.innerHTML = `
    <div class="page">
      <div class="page__content" style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;min-height:70vh;text-align:center;">
        <p style="margin:0;font-size:32px;font-weight:700;color:var(--brand);">404</p>
        <p style="margin:0;font-size:13px;color:var(--muted);">没有找到这个页面，可能入口已调整。</p>
        <button type="button" class="ph-home">返回首页</button>
      </div>
    </div>
  `;
  root.querySelector('.ph-home').addEventListener('click', () => navigate('/'));
}

export function createRouter({ root }) {
  const configResult = readRuntimeConfig();
  const config = configResult.ok ? configResult.data : null;
  const moduleApi = createSameOriginClient('');
  let cleanup = null;
  let navToken = 0;

  const context = { config, notify, navigate };

  function contextFor(entry) {
    return {
      ...context,
      api: entry.id === 'ai-assistant' ? undefined : moduleApi,
    };
  }

  function navigate(path) {
    const next = path.startsWith('/') ? path : `/${path}`;
    if (location.hash === `#${next}`) {
      render();
      return;
    }
    location.hash = next;
  }

  async function runCleanup() {
    if (typeof cleanup !== 'function') {
      cleanup = null;
      return;
    }
    try {
      await cleanup();
    } catch (error) {
      console.error('模块清理失败', error);
    }
    cleanup = null;
  }

  async function render() {
    const token = ++navToken;
    await runCleanup();
    if (token !== navToken) return;

    const path = currentPath();
    window.scrollTo({ top: 0, behavior: 'auto' });

    if (path === '/') {
      document.title = '智启云聚 · 云南大学校园服务';
      root.replaceChildren(renderHome(context));
      return;
    }

    const entry = findModule(path);
    if (!entry) {
      renderNotFound(root, context);
      return;
    }

    document.title = `${entry.title} · 智启云聚`;

    const page = document.createElement('div');
    page.className = 'page';
    page.innerHTML = `
      <header class="topbar">
        <button class="topbar__back" type="button" aria-label="返回首页">${backIcon}</button>
        <span class="topbar__title">${entry.title}</span>
        <span></span>
      </header>
      <div class="page__content"></div>
    `;
    page.querySelector('.topbar__back').addEventListener('click', () => navigate('/'));
    root.replaceChildren(page);

    const content = page.querySelector('.page__content');

    if (!entry.load) {
      content.replaceChildren(renderPlaceholder(entry, context));
      return;
    }

    content.innerHTML = '<p class="module-loading">正在加载模块…</p>';
    try {
      const mod = await entry.load();
      if (token !== navToken) return;
      if (!mod || typeof mod.mount !== 'function') {
        throw new Error('模块缺少 mount 导出');
      }
      content.replaceChildren();
      const instance = mod.mount(content, contextFor(entry));
      cleanup =
        typeof instance === 'function'
          ? instance
          : instance && typeof instance.unmount === 'function'
            ? instance.unmount
            : null;
    } catch (error) {
      console.error('模块加载失败', error);
      if (token !== navToken) return;
      content.replaceChildren(renderPlaceholder(entry, context, { failed: true }));
    }
  }

  window.addEventListener('hashchange', render);

  render();

  return {
    navigate,
    destroy() {
      window.removeEventListener('hashchange', render);
      runCleanup();
    },
  };
}
