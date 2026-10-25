import './placeholder.css';

export function renderPlaceholder(entry, { navigate }, options = {}) {
  const { failed = false } = options;

  const wrapper = document.createElement('div');
  wrapper.className = 'module-placeholder';

  wrapper.innerHTML = `
    <section class="ph-card">
      <span class="ph-icon ph-icon--${entry.tone}" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${entry.icon}</svg>
      </span>
      <h2 class="ph-title">${entry.title}</h2>
      <span class="ph-badge ${failed ? 'ph-badge--error' : ''}">${failed ? '加载失败' : '待接入'}</span>
      <p class="ph-desc">${entry.description}</p>
      <p class="ph-note">
        ${
          failed
            ? '模块页面加载失败，请返回首页后重试。'
            : '该模块尚未接入真实服务。接入后将在此展示加载、成功、空结果与错误状态。'
        }
      </p>
      <button class="ph-home" type="button">返回首页</button>
    </section>
    <p class="ph-foot">智启云聚 · 校园服务</p>
  `;

  wrapper.querySelector('.ph-home').addEventListener('click', () => navigate('/'));

  return wrapper;
}
