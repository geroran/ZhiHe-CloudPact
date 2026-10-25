import { createApiClient } from './shared/api.js';
import { readRuntimeConfig } from './shared/config.js';
import { mount as mountAiAssistant } from './modules/ai-assistant/index.js';
import { mount as mountCampusCalendar } from './modules/campus-calendar/index.js';
import { mount as mountChargingMap } from './modules/charging-map/index.js';
import { mount as mountDreamspaceEvents } from './modules/dreamspace-events/index.js';
import { mount as mountTimetable } from './modules/timetable/index.js';

const MODULES = [
  {
    id: 'ai-assistant',
    title: '校园 AI 助手',
    mount: mountAiAssistant
  },
  {
    id: 'campus-calendar',
    title: '校历与校车',
    mount: mountCampusCalendar
  },
  {
    id: 'timetable',
    title: 'AI 课表',
    mount: mountTimetable
  },
  {
    id: 'charging-map',
    title: '桦苑充电口',
    mount: mountChargingMap
  },
  {
    id: 'dreamspace-events',
    title: '到梦空间活动',
    mount: mountDreamspaceEvents
  }
];

const DEFAULT_ROUTE = 'ai-assistant';
const navElement = document.getElementById('site-nav');
const appElement = document.getElementById('app');
const toastElement = document.getElementById('toast');

let currentUnmount = null;
let toastTimer = null;

function showToast(message) {
  if (!toastElement) return;
  toastElement.textContent = message;
  toastElement.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastElement.hidden = true;
  }, 2600);
}

function currentRoute() {
  const raw = window.location.hash.replace(/^#\/?/, '').trim();
  return raw || DEFAULT_ROUTE;
}

function renderNav(activeRoute) {
  navElement.innerHTML = '';
  for (const module of MODULES) {
    const link = document.createElement('a');
    link.href = `#/${module.id}`;
    link.textContent = module.title;
    link.className = 'site-nav__link';
    if (module.id === activeRoute) link.classList.add('is-active');
    link.setAttribute('aria-current', module.id === activeRoute ? 'page' : 'false');
    navElement.appendChild(link);
  }
}

function renderGlobalError(title, messages) {
  appElement.innerHTML = '';
  const section = document.createElement('section');
  section.className = 'global-error';

  const heading = document.createElement('h1');
  heading.textContent = title;
  section.appendChild(heading);

  for (const message of messages) {
    const paragraph = document.createElement('p');
    paragraph.textContent = message;
    section.appendChild(paragraph);
  }

  appElement.appendChild(section);
}

const configResult = readRuntimeConfig();
const api = configResult.ok ? createApiClient(configResult.data) : null;

const context = configResult.ok
  ? {
      api,
      config: configResult.data,
      notify: showToast,
      navigate: (routeId) => {
        window.location.hash = `#/${routeId}`;
      }
    }
  : null;

function render() {
  const route = currentRoute();
  const moduleDefinition = MODULES.find((module) => module.id === route);

  updateDocumentTitle(route);
  renderNav(route);

  if (currentUnmount) {
    try {
      currentUnmount();
    } catch {
      // 单个模块清理失败不应阻止路由切换。
    }
    currentUnmount = null;
  }

  appElement.innerHTML = '';

  if (!moduleDefinition) {
    renderGlobalError('页面不存在', ['请从顶部导航选择已接入的功能。']);
    return;
  }

  if (!configResult.ok) {
    renderGlobalError('运行配置未加载', [
      configResult.error.message,
      '请通过 npm run dev 启动，并在项目根目录创建 .env.local（可从 .env.example 复制）。'
    ]);
    return;
  }

  try {
    const unmount = moduleDefinition.mount(appElement, context);
    currentUnmount = typeof unmount === 'function' ? unmount : null;
  } catch (error) {
    console.error('模块挂载失败:', error instanceof Error ? error.message : 'unknown');
    renderGlobalError('模块加载失败', ['请刷新页面后重试；若问题持续，请检查本地服务日志。']);
  }
}

function updateDocumentTitle(route) {
  const moduleDefinition = MODULES.find((module) => module.id === route);
  document.title = moduleDefinition
    ? `${moduleDefinition.title} · 智启云聚`
    : '智启云聚 · 校园 AI 助手';
}

window.addEventListener('hashchange', render);
render();
