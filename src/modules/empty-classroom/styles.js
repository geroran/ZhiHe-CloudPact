/**
 * 模块样式通过 <style> 注入，避免额外构建配置；全部选择器限定在 .empty-classroom 下。
 */
export const EMPTY_CLASSROOM_STYLES = `
.empty-classroom {
  --ec-primary: var(--color-primary, #2b3f81);
  --ec-primary-soft: #eef2ff;
  --ec-bg: var(--color-bg, #f5f7fb);
  --ec-surface: #ffffff;
  --ec-border: #dbe2f0;
  --ec-border-strong: #c3cee6;
  --ec-text: #1c2333;
  --ec-muted: #5c667a;
  --ec-danger: #b42318;
  --ec-danger-bg: #fef3f2;
  --ec-success: #0f7b4f;
  --ec-radius: 14px;
  color: var(--ec-text);
  display: flex;
  flex-direction: column;
  gap: 16px;
  font-size: 14px;
  line-height: 1.5;
  min-width: 0;
}

.empty-classroom *,
.empty-classroom *::before,
.empty-classroom *::after {
  box-sizing: border-box;
}

.empty-classroom :focus-visible {
  outline: 2px solid var(--ec-primary);
  outline-offset: 2px;
}

.empty-classroom .ec-hero {
  background: var(--ec-surface);
  border: 1px solid var(--ec-border);
  border-radius: var(--ec-radius);
  padding: 20px 22px;
}

.empty-classroom .ec-hero__main {
  align-items: center;
  display: flex;
  gap: 14px;
  min-width: 0;
}

.empty-classroom .ec-logo {
  align-items: center;
  background: #2b3f81;
  border-radius: 10px;
  display: inline-flex;
  flex: 0 0 auto;
  justify-content: center;
  max-width: 100%;
  padding: 8px 14px;
}

.empty-classroom .ec-logo__image {
  display: block;
  height: 30px;
  max-width: 100%;
  object-fit: contain;
  width: auto;
}

.empty-classroom .ec-title {
  font-size: 20px;
  line-height: 1.25;
  margin: 0;
}

.empty-classroom .ec-term {
  color: var(--ec-muted);
  margin: 4px 0 0;
  overflow-wrap: anywhere;
}

.empty-classroom .ec-hint {
  color: var(--ec-muted);
  margin: 14px 0 0;
}

.empty-classroom .ec-alert {
  align-items: flex-start;
  background: var(--ec-danger-bg);
  border: 1px solid #f2b8b5;
  border-radius: var(--ec-radius);
  color: var(--ec-danger);
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  justify-content: space-between;
  padding: 14px 16px;
}

.empty-classroom .ec-alert[hidden] {
  display: none;
}

.empty-classroom .ec-alert__text {
  flex: 1 1 260px;
  min-width: 0;
  overflow-wrap: anywhere;
}

.empty-classroom .ec-panel,
.empty-classroom .ec-results {
  background: var(--ec-surface);
  border: 1px solid var(--ec-border);
  border-radius: var(--ec-radius);
  padding: 18px 20px 20px;
}

.empty-classroom .ec-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.empty-classroom .ec-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.empty-classroom .ec-field > span,
.empty-classroom .ec-filter > span {
  color: var(--ec-muted);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.empty-classroom select,
.empty-classroom input[type='search'],
.empty-classroom input[type='number'] {
  background: #fff;
  border: 1px solid var(--ec-border-strong);
  border-radius: 10px;
  color: var(--ec-text);
  font: inherit;
  height: 40px;
  min-width: 0;
  padding: 0 10px;
  width: 100%;
}

.empty-classroom select:disabled,
.empty-classroom input:disabled {
  background: #f2f4f9;
  color: #98a1b3;
  cursor: not-allowed;
}

.empty-classroom .ec-sections {
  border: 1px solid var(--ec-border);
  border-radius: 12px;
  margin: 16px 0 0;
  min-width: 0;
  padding: 12px 14px 14px;
}

.empty-classroom .ec-sections legend {
  color: var(--ec-muted);
  font-size: 12px;
  font-weight: 600;
  padding: 0 6px;
}

.empty-classroom .ec-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}

.empty-classroom .ec-preset,
.empty-classroom .ec-section {
  background: #fff;
  border: 1px solid var(--ec-border-strong);
  border-radius: 9px;
  color: var(--ec-text);
  cursor: pointer;
  font: inherit;
  min-height: 34px;
  padding: 5px 12px;
}

.empty-classroom .ec-preset:hover,
.empty-classroom .ec-section:hover {
  border-color: var(--ec-primary);
}

.empty-classroom .ec-preset.is-active,
.empty-classroom .ec-section.is-active {
  background: var(--ec-primary);
  border-color: var(--ec-primary);
  color: #fff;
  font-weight: 600;
}

.empty-classroom .ec-preset:disabled,
.empty-classroom .ec-section:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.empty-classroom .ec-section-grid {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(12, minmax(0, 1fr));
}

.empty-classroom .ec-section {
  padding: 5px 4px;
  width: 100%;
}

.empty-classroom .ec-actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  margin-top: 16px;
}

.empty-classroom .ec-btn {
  border: 1px solid transparent;
  border-radius: 10px;
  cursor: pointer;
  font: inherit;
  font-weight: 600;
  min-height: 40px;
  padding: 0 18px;
}

.empty-classroom .ec-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.empty-classroom .ec-btn--primary {
  background: var(--ec-primary);
  color: #fff;
}

.empty-classroom .ec-btn--primary:hover:not(:disabled) {
  filter: brightness(1.08);
}

.empty-classroom .ec-btn--ghost {
  background: #fff;
  border-color: var(--ec-border-strong);
  color: var(--ec-text);
}

.empty-classroom .ec-btn--ghost:hover:not(:disabled) {
  border-color: var(--ec-primary);
  color: var(--ec-primary);
}

.empty-classroom .ec-status {
  color: var(--ec-muted);
  flex: 1 1 240px;
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}

.empty-classroom .ec-status.is-error {
  color: var(--ec-danger);
}

.empty-classroom .ec-status.is-ok {
  color: var(--ec-success);
}

.empty-classroom .ec-status.is-busy {
  color: var(--ec-primary);
}

.empty-classroom .ec-results__head {
  align-items: flex-start;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  justify-content: space-between;
}

.empty-classroom .ec-results__head h3 {
  font-size: 16px;
  margin: 0;
}

.empty-classroom .ec-summary {
  color: var(--ec-muted);
  margin: 4px 0 0;
  overflow-wrap: anywhere;
}

.empty-classroom .ec-count {
  background: var(--ec-primary-soft);
  border-radius: 999px;
  color: var(--ec-primary);
  flex: 0 0 auto;
  font-size: 12px;
  font-weight: 700;
  padding: 4px 12px;
}

.empty-classroom .ec-count[hidden] {
  display: none;
}

.empty-classroom .ec-filters {
  align-items: flex-end;
  border-top: 1px solid var(--ec-border);
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
  margin-top: 14px;
  padding-top: 14px;
}

.empty-classroom .ec-filter {
  display: flex;
  flex: 1 1 180px;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.empty-classroom .ec-filter--seats {
  flex: 0 1 130px;
}

.empty-classroom .ec-check {
  align-items: center;
  align-self: center;
  color: var(--ec-text);
  display: inline-flex;
  gap: 7px;
  min-height: 40px;
  white-space: nowrap;
}

.empty-classroom .ec-check input {
  accent-color: var(--ec-primary);
  height: 16px;
  width: 16px;
}

.empty-classroom .ec-results__body {
  margin-top: 16px;
}

.empty-classroom .ec-state {
  border: 1px dashed var(--ec-border-strong);
  border-radius: 12px;
  color: var(--ec-muted);
  padding: 22px 16px;
  text-align: center;
  overflow-wrap: anywhere;
}

.empty-classroom .ec-state--error {
  background: var(--ec-danger-bg);
  border-color: #f2b8b5;
  color: var(--ec-danger);
}

.empty-classroom .ec-state .ec-btn {
  margin-top: 12px;
}

.empty-classroom .ec-group + .ec-group {
  margin-top: 18px;
}

.empty-classroom .ec-group__title {
  align-items: baseline;
  display: flex;
  gap: 10px;
  margin: 0 0 10px;
}

.empty-classroom .ec-group__title h4 {
  font-size: 15px;
  margin: 0;
  overflow-wrap: anywhere;
}

.empty-classroom .ec-group__title span {
  color: var(--ec-muted);
  font-size: 12px;
  font-weight: 600;
}

.empty-classroom .ec-room-list {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  list-style: none;
  margin: 0;
  padding: 0;
}

.empty-classroom .ec-room {
  border: 1px solid var(--ec-border);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 12px 14px;
}

.empty-classroom .ec-room__top {
  align-items: flex-start;
  display: flex;
  gap: 10px;
  justify-content: space-between;
  min-width: 0;
}

.empty-classroom .ec-room__name {
  font-weight: 600;
  min-width: 0;
  overflow-wrap: anywhere;
}

.empty-classroom .ec-room__meta {
  color: var(--ec-muted);
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  font-size: 12px;
}

.empty-classroom .ec-tag {
  border-radius: 999px;
  flex: 0 0 auto;
  font-size: 11px;
  font-weight: 700;
  padding: 3px 8px;
  white-space: nowrap;
}

.empty-classroom .ec-tag--borrowable {
  background: #e7f6ee;
  color: var(--ec-success);
}

.empty-classroom .ec-tag--free {
  background: #eef2ff;
  color: var(--ec-primary);
}

.empty-classroom .ec-skeleton {
  border: 1px solid var(--ec-border);
  border-radius: 12px;
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
}

.empty-classroom .ec-skeleton__item {
  animation: ec-pulse 1.2s ease-in-out infinite;
  background: linear-gradient(90deg, #eef1f7, #f8fafc, #eef1f7);
  background-size: 200% 100%;
  border-radius: 12px;
  height: 88px;
}

.empty-classroom .ec-footer {
  color: var(--ec-muted);
  font-size: 12px;
  padding: 0 4px 4px;
  overflow-wrap: anywhere;
}

.empty-classroom .ec-footer p {
  margin: 0;
}

.empty-classroom .ec-footer p + p {
  margin-top: 4px;
}

@keyframes ec-pulse {
  0% { background-position: 0% 0; }
  100% { background-position: -200% 0; }
}

@media (max-width: 760px) {
  .empty-classroom .ec-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .empty-classroom .ec-section-grid {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
}

@media (max-width: 420px) {
  .empty-classroom .ec-hero,
  .empty-classroom .ec-panel,
  .empty-classroom .ec-results {
    padding: 16px 14px;
  }
  .empty-classroom .ec-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .empty-classroom .ec-logo {
    padding: 7px 11px;
  }
  .empty-classroom .ec-logo__image {
    height: 24px;
  }
  .empty-classroom .ec-section-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
  .empty-classroom .ec-room-list {
    grid-template-columns: minmax(0, 1fr);
  }
  .empty-classroom .ec-btn {
    width: 100%;
  }
  .empty-classroom .ec-actions {
    align-items: stretch;
    flex-direction: column;
  }
}
`;
