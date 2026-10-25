import { gridModules, homeModule } from '../modules/registry.js';
import './home.css';

const LOGO_URL = 'https://www.ynu.edu.cn/images/logo0430.png';

const arrowIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

function tileTemplate(item) {
  return `
    <button class="tile tile--${item.tone}" type="button" data-route="${item.path}">
      <span class="tile__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${item.icon}</svg>
      </span>
      <span class="tile__name">${item.title}</span>
      <span class="tile__hint">${item.short}</span>
    </button>
  `;
}

export function renderHome({ navigate }) {
  const home = document.createElement('div');
  home.className = 'home';

  home.innerHTML = `
    <header class="hero">
      <span class="hero__glow" aria-hidden="true"></span>
      <div class="hero__bar">
        <span class="hero__logo">
          <img src="${LOGO_URL}" alt="云南大学" />
        </span>
        <span class="hero__badge">校园服务</span>
      </div>

      <p class="hero__eyebrow">YUNNAN UNIVERSITY</p>
      <h1 class="hero__title">智启云聚</h1>
      <p class="hero__subtitle">云南大学校园信息与智能服务平台</p>

      <button class="hero__ask" type="button" data-route="${homeModule.path}">
        <span class="hero__ask-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${homeModule.icon}</svg>
        </span>
        <span class="hero__ask-copy">
          <strong>一句话，直接问</strong>
          <small>空教室 · 充电口 · 课程 · 活动</small>
        </span>
        <span class="hero__ask-arrow" aria-hidden="true">${arrowIcon}</span>
      </button>

      <div class="hero__foot">
        <span>呈贡校区</span>
        <i aria-hidden="true"></i>
        <span>东陆校区</span>
      </div>
    </header>

    <main class="home__main">
      <section class="services" aria-labelledby="services-title">
        <div class="section-head">
          <h2 id="services-title">校园服务</h2>
          <span>${gridModules.length} 个入口</span>
        </div>
        <div class="tiles">
          ${gridModules.map(tileTemplate).join('')}
        </div>
      </section>

      <section class="note" aria-label="数据说明">
        <span class="note__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3l7 3v5c0 4.4-3 8.1-7 10-4-1.9-7-5.6-7-10V6l7-3Z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
        </span>
        <div class="note__body">
          <strong>真实数据优先</strong>
          <p>服务状态以真实接口返回为准；未接通时会明确提示，不使用演示数据冒充结果。</p>
        </div>
      </section>

      <footer class="foot">
        智启云聚 · 云南大学
        <span>校园信息与智能服务入口</span>
      </footer>
    </main>
  `;

  home.querySelectorAll('[data-route]').forEach((element) => {
    element.addEventListener('click', () => navigate(element.dataset.route));
  });

  return home;
}
