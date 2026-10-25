import './shell.css';
import { mount as mountMarketAgent } from '../modules/market-agent/index.js';
import { createDevApi } from './api-client.js';

const api = createDevApi();
const app = document.querySelector('#app');
let unmountCurrent = null;

function renderShell() {
  app.innerHTML = `
    <div class="dev-shell">
      <header class="dev-shell__top">
        <a class="dev-shell__brand" href="#/">
          <span class="dev-shell__logo" aria-hidden="true">智</span>
          <span>智启云聚</span>
        </a>
        <nav class="dev-shell__nav" aria-label="主导航">
          <a href="#/" data-route="/">首页</a>
          <a href="#/market-agent" data-route="/market-agent">校园集市 Agent</a>
        </nav>
      </header>
      <main class="dev-shell__main" id="dev-view"></main>
      <div class="dev-shell__toast" id="dev-toast" role="status" hidden></div>
    </div>
  `;
}

function notify(message) {
  const toast = document.querySelector('#dev-toast');
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(notify.timer);
  notify.timer = window.setTimeout(() => {
    toast.hidden = true;
  }, 2200);
}

function renderHome(view) {
  view.innerHTML = `
    <section class="dev-home">
      <h1>智启云聚 · 校园集市 Agent</h1>
      <p>本页仅用于开发验证模块的挂载、错误状态和接口边界；正式入口由宿主主导航提供。</p>
      <a class="dev-home__enter" href="#/market-agent">进入校园集市 Agent</a>
    </section>
  `;
}

function renderRoute() {
  if (unmountCurrent) {
    unmountCurrent();
    unmountCurrent = null;
  }
  const view = document.querySelector('#dev-view');
  if (!view) return;
  const route = window.location.hash.replace(/^#/, '') || '/';
  document.querySelectorAll('[data-route]').forEach((link) => {
    link.toggleAttribute('aria-current', link.dataset.route === route);
    if (link.dataset.route === route) link.setAttribute('aria-current', 'page');
  });

  if (route === '/' || route === '') {
    renderHome(view);
    return;
  }
  if (route === '/market-agent') {
    const root = document.createElement('div');
    view.replaceChildren(root);
    unmountCurrent = mountMarketAgent(root, {
      api,
      notify,
      navigate: (path) => {
        window.location.hash = `#${path}`;
      },
    });
    return;
  }
  view.innerHTML = '<p class="dev-home">页面不存在。</p>';
}

renderShell();
renderRoute();
window.addEventListener('hashchange', renderRoute);
