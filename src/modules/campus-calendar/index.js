import './campus-calendar.css';

import semester1Image from './assets/semester-1-autumn.webp';
import semester2Image from './assets/semester-2-spring.webp';
import campusBusImage from './assets/campus-bus.webp';

const ITEMS = [
  {
    id: 'semester-1',
    badge: '第一学期 · 秋季',
    title: '第一学期校历',
    period: '2026年8月26日 — 2027年1月17日',
    description: '共 20 周，第十九、二十周为期末考试周。',
    image: semester1Image,
    originalUrl: 'https://img.cdn1.vip/i/6ad85e390220e_1792564793.webp',
    alt: '云南大学 2026 至 2027 学年第一学期（秋季）校历，时间为 2026 年 8 月 26 日至 2027 年 1 月 17 日。',
  },
  {
    id: 'semester-2',
    badge: '第二学期 · 春季',
    title: '第二学期校历',
    period: '2027年2月18日 — 2027年7月11日',
    description: '共 20 周，第十九、二十周为期末考试周。',
    image: semester2Image,
    originalUrl: 'https://img.cdn1.vip/i/6ad85e3941706_1792564793.webp',
    alt: '云南大学 2026 至 2027 学年第二学期（春季）校历，时间为 2027 年 2 月 18 日至 2027 年 7 月 11 日。',
  },
  {
    id: 'campus-bus',
    badge: '校车 · 通勤',
    title: '校车运行时间表',
    period: '呈贡 · 东陆 · 龙泉小区',
    description: '含三地发车时刻，节假日及周末部分班次调整。',
    image: campusBusImage,
    originalUrl: 'https://picui.ogmua.cn/s1/2026/10/25/6add9c701ffa0.webp',
    alt: '云南大学校车运行时间表，包含呈贡、东陆、龙泉小区发车时刻及节假日调整说明。',
  },
];

function cardTemplate(item, index) {
  return `
    <li class="zhyq-calendar__card" data-card="${item.id}">
      <div class="zhyq-calendar__media" data-media aria-busy="true">
        <span class="zhyq-calendar__skeleton" aria-hidden="true"></span>
        <img
          class="zhyq-calendar__image"
          src="${item.image}"
          alt="${item.alt}"
          loading="${index === 0 ? 'eager' : 'lazy'}"
          decoding="async"
        />
        <button
          class="zhyq-calendar__zoom"
          type="button"
          data-zoom="${index}"
          aria-label="放大查看${item.title}"
        >
          <span class="zhyq-calendar__zoom-label" aria-hidden="true">查看大图</span>
        </button>
        <div class="zhyq-calendar__error">
          <p class="zhyq-calendar__error-text">图片加载失败</p>
          <div class="zhyq-calendar__error-actions">
            <button class="zhyq-calendar__retry" type="button" data-retry="${index}">重新加载</button>
            <a
              class="zhyq-calendar__error-link"
              href="${item.originalUrl}"
              target="_blank"
              rel="noopener noreferrer"
            >打开原图</a>
          </div>
        </div>
      </div>
      <div class="zhyq-calendar__body">
        <span class="zhyq-calendar__badge">${item.badge}</span>
        <h3 class="zhyq-calendar__card-title">${item.title}</h3>
        <p class="zhyq-calendar__period">${item.period}</p>
        <p class="zhyq-calendar__desc">${item.description}</p>
        <a
          class="zhyq-calendar__link"
          href="${item.originalUrl}"
          target="_blank"
          rel="noopener noreferrer"
        >打开原图<span aria-hidden="true">↗</span></a>
      </div>
    </li>
  `;
}

export function mount(rootElement, context = {}) {
  const uid = `zhyq-calendar-${Math.random().toString(36).slice(2, 8)}`;
  const titleId = `${uid}-title`;
  const dialogTitleId = `${uid}-dialog-title`;

  rootElement.innerHTML = `
    <section class="zhyq-calendar" aria-labelledby="${titleId}">
      <header class="zhyq-calendar__header">
        <div class="zhyq-calendar__heading">
          <p class="zhyq-calendar__eyebrow">校园服务</p>
          <h2 class="zhyq-calendar__title" id="${titleId}">校历与校车</h2>
          <p class="zhyq-calendar__subtitle">
            云南大学学期校历与校车运行时间，点击图片可查看大图。
          </p>
        </div>
        <p class="zhyq-calendar__hint">点击图片可放大查看</p>
      </header>

      <ul class="zhyq-calendar__grid">
        ${ITEMS.map(cardTemplate).join('')}
      </ul>

      <p class="zhyq-calendar__note">校历与校车时刻以学校最新通知为准。</p>

      <dialog class="zhyq-calendar__dialog" aria-labelledby="${dialogTitleId}">
        <div class="zhyq-calendar__dialog-bar">
          <p class="zhyq-calendar__dialog-title" id="${dialogTitleId}"></p>
          <button
            class="zhyq-calendar__dialog-close"
            type="button"
            data-close
            aria-label="关闭大图"
          >&times;</button>
        </div>
        <div class="zhyq-calendar__dialog-stage">
          <img class="zhyq-calendar__dialog-image" alt="" />
        </div>
      </dialog>
    </section>
  `;

  const section = rootElement.querySelector('.zhyq-calendar');
  const dialog = section.querySelector('.zhyq-calendar__dialog');
  const dialogTitle = section.querySelector('.zhyq-calendar__dialog-title');
  const dialogImage = section.querySelector('.zhyq-calendar__dialog-image');
  const mediaElements = Array.from(section.querySelectorAll('[data-media]'));
  const retryCounts = ITEMS.map(() => 0);
  const controller = new AbortController();
  const { signal } = controller;

  mediaElements.forEach((media) => {
    const image = media.querySelector('.zhyq-calendar__image');

    const markLoaded = () => {
      media.classList.remove('has-error');
      media.classList.add('is-loaded');
      media.setAttribute('aria-busy', 'false');
    };

    const markFailed = () => {
      media.classList.remove('is-loaded');
      media.classList.add('has-error');
      media.setAttribute('aria-busy', 'false');
    };

    image.addEventListener('load', markLoaded, { signal });
    image.addEventListener('error', markFailed, { signal });

    if (image.complete) {
      if (image.naturalWidth > 0) {
        markLoaded();
      } else {
        markFailed();
      }
    }
  });

  const retryImage = (index) => {
    const media = mediaElements[index];
    if (!media) return;

    const image = media.querySelector('.zhyq-calendar__image');
    const item = ITEMS[index];

    retryCounts[index] += 1;
    media.classList.remove('has-error', 'is-loaded');
    media.setAttribute('aria-busy', 'true');
    image.src = `${item.image}?retry=${retryCounts[index]}`;
  };

  const openDialog = (index) => {
    const item = ITEMS[index];
    if (!item) return;

    dialogTitle.textContent = item.title;
    dialogImage.src = item.image;
    dialogImage.alt = item.alt;

    if (!dialog.open) {
      dialog.showModal();
    }
  };

  section.addEventListener(
    'click',
    (event) => {
      const zoomButton = event.target.closest('[data-zoom]');
      if (zoomButton) {
        openDialog(Number(zoomButton.dataset.zoom));
        return;
      }

      const retryButton = event.target.closest('[data-retry]');
      if (retryButton) {
        retryImage(Number(retryButton.dataset.retry));
        return;
      }

      if (event.target.closest('[data-close]')) {
        dialog.close();
        return;
      }

      if (event.target === dialog) {
        dialog.close();
      }
    },
    { signal },
  );

  return function unmount() {
    controller.abort();
    if (dialog.open) {
      dialog.close();
    }
    rootElement.innerHTML = '';
  };
}

export default mount;
