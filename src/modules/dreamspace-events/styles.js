/** 模块样式以字符串注入，兼容 Vite 构建与浏览器原生 ESM 单页测试。 */
export const MODULE_CSS = `
.dse-root {
  --dse-brand: var(--brand, #2b3f81);
  --dse-brand-strong: #22336b;
  --dse-ink: #1f2430;
  --dse-muted: #5b6475;
  --dse-line: #dfe4ef;
  --dse-bg: #ffffff;
  --dse-surface: #f5f7fb;
  --dse-radius: 12px;
  color: var(--dse-ink);
  font-family: inherit;
}
.dse-root, .dse-root * { box-sizing: border-box; }
.dse-root button { font-family: inherit; }
.dse-root a { color: var(--dse-brand); }

/* 外框留白交给宿主（主站 .site-main / 测试页 #module-root），避免双重内边距。 */
.dse-root .dse-page { max-width: 1200px; margin: 0 auto; padding: 0 0 16px; }

.dse-root .dse-panel {
  background: var(--dse-bg);
  border: 1px solid var(--dse-line);
  border-radius: var(--dse-radius);
  padding: 24px;
}

.dse-root .dse-heading { margin: 0 0 8px; font-size: 22px; line-height: 1.35; }
.dse-root .dse-sub { margin: 0; color: var(--dse-muted); font-size: 13px; line-height: 1.6; }

.dse-root .dse-topbar {
  display: flex; flex-wrap: wrap; gap: 12px;
  align-items: flex-start; justify-content: space-between;
  margin-bottom: 16px;
}
.dse-root .dse-session { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.dse-root .dse-user { font-size: 13px; color: var(--dse-muted); }

.dse-root .dse-btn {
  appearance: none; border: 1px solid var(--dse-brand);
  background: var(--dse-brand); color: #fff;
  border-radius: 8px; padding: 8px 14px; min-height: 36px;
  font-size: 13px; line-height: 1.2; cursor: pointer;
}
.dse-root .dse-btn:hover { background: var(--dse-brand-strong); }
.dse-root .dse-btn:disabled { opacity: .55; cursor: not-allowed; }
.dse-root .dse-btn-secondary {
  background: #fff; color: var(--dse-brand); border-color: var(--dse-line);
}
.dse-root .dse-btn-secondary:hover { background: var(--dse-surface); }
.dse-root .dse-btn-small { min-height: 30px; padding: 5px 10px; font-size: 12px; }
.dse-root .dse-btn:focus-visible,
.dse-root .dse-card-title:focus-visible,
.dse-root .dse-input:focus-visible,
.dse-root .dse-select:focus-visible {
  outline: 3px solid rgba(43, 63, 129, .35); outline-offset: 2px;
}

.dse-root .dse-banner {
  border-radius: 10px; padding: 10px 12px; margin-bottom: 14px;
  font-size: 13px; line-height: 1.55; border: 1px solid transparent;
  display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
}
.dse-root .dse-banner-info { background: #eef2fd; border-color: #ccd7f5; color: #263b78; }
.dse-root .dse-banner-success { background: #eaf6ef; border-color: #c6e7d3; color: #15603c; }
.dse-root .dse-banner-warn { background: #fff7e6; border-color: #f2ddae; color: #7a5410; }
.dse-root .dse-banner-error { background: #fdeeee; border-color: #f3c9c9; color: #8b2323; }

.dse-root .dse-meta {
  display: flex; flex-wrap: wrap; gap: 8px 18px; align-items: center;
  margin-bottom: 14px; font-size: 13px; color: var(--dse-muted);
}
.dse-root .dse-stats { display: flex; flex-wrap: wrap; gap: 6px; }
.dse-root .dse-stat {
  border: 1px solid var(--dse-line); background: var(--dse-surface);
  border-radius: 999px; padding: 2px 10px; font-size: 12px; color: var(--dse-muted);
}
.dse-root .dse-stat b { color: var(--dse-ink); font-weight: 600; }

.dse-root .dse-controls {
  display: flex; flex-wrap: wrap; gap: 10px; align-items: center;
  margin-bottom: 16px;
}
.dse-root .dse-input, .dse-root .dse-select {
  min-height: 38px; border: 1px solid var(--dse-line); border-radius: 8px;
  padding: 8px 10px; font-size: 14px; background: #fff; color: var(--dse-ink);
  min-width: 0;
}
.dse-root .dse-input { flex: 1 1 220px; }
.dse-root .dse-select { flex: 0 1 150px; }
.dse-root .dse-count { font-size: 12px; color: var(--dse-muted); }

.dse-root .dse-list {
  display: grid; gap: 12px;
  grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
}
.dse-root .dse-card {
  border: 1px solid var(--dse-line); border-radius: var(--dse-radius);
  padding: 14px; background: #fff; display: flex; flex-direction: column; gap: 8px;
  min-width: 0;
}
.dse-root .dse-card:hover { border-color: #c3cce4; }
.dse-root .dse-card-head { display: flex; gap: 8px; align-items: flex-start; justify-content: space-between; }
.dse-root .dse-card-title {
  appearance: none; border: 0; background: none; padding: 0; margin: 0;
  text-align: left; font-size: 15px; font-weight: 600; line-height: 1.45;
  color: var(--dse-ink); cursor: pointer; overflow-wrap: anywhere;
}
.dse-root .dse-card-title:hover { color: var(--dse-brand); }
.dse-root .dse-badge {
  flex: 0 0 auto; border-radius: 999px; padding: 2px 9px;
  font-size: 12px; line-height: 1.6; white-space: nowrap;
  border: 1px solid var(--dse-line); background: var(--dse-surface); color: var(--dse-muted);
}
.dse-root .dse-badge-open { background: #e8f5ee; border-color: #bfe3cf; color: #126341; }
.dse-root .dse-badge-full { background: #fdecec; border-color: #f2c6c6; color: #8d2626; }
.dse-root .dse-badge-soon { background: #fff6e3; border-color: #f0dcb0; color: #7c560f; }
.dse-root .dse-badge-running { background: #eaf1fd; border-color: #c7d5f3; color: #264080; }
.dse-root .dse-badge-ended { background: #f0f1f4; border-color: #dbdee5; color: #596070; }
.dse-root .dse-badge-unknown { background: #f4f4f6; border-color: #e0e2e8; color: #656b79; }

.dse-root .dse-card-meta { margin: 0; font-size: 12px; color: var(--dse-muted); line-height: 1.5; }
.dse-root .dse-facts { display: flex; flex-wrap: wrap; gap: 6px; }
.dse-root .dse-fact {
  font-size: 12px; line-height: 1.5; color: #384152;
  background: var(--dse-surface); border-radius: 6px; padding: 2px 8px;
  overflow-wrap: anywhere;
}
.dse-root .dse-fact-warn { background: #fff6e3; color: #7c560f; }
.dse-root .dse-card-actions { display: flex; gap: 8px; margin-top: auto; padding-top: 4px; }

.dse-root .dse-empty {
  border: 1px dashed var(--dse-line); border-radius: var(--dse-radius);
  padding: 28px 16px; text-align: center; color: var(--dse-muted); font-size: 14px;
  background: #fff;
}

.dse-root .dse-login-wrap {
  display: grid; gap: 18px; align-items: start;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, .9fr);
}
@media (max-width: 720px) {
  .dse-root .dse-login-wrap { grid-template-columns: 1fr; }
}
.dse-root .dse-form { display: grid; gap: 14px; margin-top: 4px; }
.dse-root .dse-field { display: grid; gap: 6px; }
.dse-root .dse-label { font-size: 13px; font-weight: 600; }
.dse-root .dse-hint { font-size: 12px; color: var(--dse-muted); line-height: 1.6; }
.dse-root .dse-form-error { color: #8b2323; font-size: 13px; line-height: 1.5; }
.dse-root .dse-aside {
  border: 1px solid var(--dse-line); border-radius: var(--dse-radius);
  background: var(--dse-surface); padding: 16px; font-size: 13px; line-height: 1.7;
  color: var(--dse-muted);
}
.dse-root .dse-aside ul { margin: 8px 0 0; padding-left: 18px; }

.dse-root .dse-state-title { margin: 0 0 8px; font-size: 18px; }
.dse-root .dse-state-text { margin: 0 0 14px; color: var(--dse-muted); font-size: 14px; line-height: 1.7; }
.dse-root .dse-state-code { font-size: 12px; color: var(--dse-muted); }
.dse-root .dse-loading { display: flex; gap: 10px; align-items: center; color: var(--dse-muted); font-size: 14px; }
.dse-root .dse-spinner {
  width: 16px; height: 16px; border-radius: 50%;
  border: 2px solid #cfd6e6; border-top-color: var(--dse-brand);
  animation: dse-spin .8s linear infinite;
}
@keyframes dse-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .dse-root .dse-spinner { animation-duration: 2.4s; }
}

.dse-root .dse-dialog {
  border: 0; padding: 0; width: min(640px, calc(100vw - 24px));
  max-height: calc(100vh - 48px); border-radius: 14px;
  box-shadow: 0 20px 60px rgba(18, 28, 55, .28);
  background: #fff; color: var(--dse-ink);
}
.dse-root .dse-dialog::backdrop { background: rgba(17, 24, 39, .45); }
.dse-root .dse-dialog-body { padding: 20px; overflow: auto; max-height: calc(100vh - 48px); }
.dse-root .dse-dialog-head {
  display: flex; gap: 12px; align-items: flex-start; justify-content: space-between;
  margin-bottom: 14px;
}
.dse-root .dse-dialog-title { margin: 0; font-size: 18px; line-height: 1.4; overflow-wrap: anywhere; }
.dse-root .dse-dialog-close {
  appearance: none; border: 1px solid var(--dse-line); background: #fff;
  color: var(--dse-muted); border-radius: 8px; min-width: 34px; min-height: 34px;
  font-size: 16px; cursor: pointer;
}
.dse-root .dse-dialog-close:hover { background: var(--dse-surface); }
.dse-root .dse-detail-status { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; }
.dse-root .dse-detail-counts {
  display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px;
}
.dse-root .dse-detail-counts .dse-fact { font-size: 13px; padding: 4px 10px; }
.dse-root .dse-detail-grid {
  display: grid; grid-template-columns: 96px minmax(0, 1fr);
  gap: 8px 12px; font-size: 13px; line-height: 1.65;
}
.dse-root .dse-detail-key { color: var(--dse-muted); }
.dse-root .dse-detail-value { overflow-wrap: anywhere; }
.dse-root .dse-detail-foot { margin-top: 16px; font-size: 12px; color: var(--dse-muted); line-height: 1.7; }
.dse-root .dse-detail-error { color: #8b2323; font-size: 13px; line-height: 1.6; margin-bottom: 10px; }

@media (max-width: 420px) {
  .dse-root .dse-page { padding: 0 0 8px; }
  .dse-root .dse-panel { padding: 18px 14px; }
  .dse-root .dse-list { grid-template-columns: 1fr; }
  .dse-root .dse-detail-grid { grid-template-columns: 1fr; gap: 2px 0; }
  .dse-root .dse-detail-key { margin-top: 6px; font-weight: 600; }
}
`;

let styleNode = null;

export function ensureStyle() {
  if (styleNode && styleNode.isConnected) return styleNode;
  styleNode = document.createElement('style');
  styleNode.setAttribute('data-dse-style', 'dreamspace-events');
  styleNode.textContent = MODULE_CSS;
  document.head.append(styleNode);
  return styleNode;
}
