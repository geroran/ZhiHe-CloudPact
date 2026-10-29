export const COURSE_GRADES_STYLES = `
.course-grades {
  --cg-brand: var(--brand-primary, #2b3f81);
  --cg-brand-dark: var(--brand-primary-dark, #1f2f63);
  --cg-text: var(--text-primary, #1f2430);
  --cg-muted: var(--text-secondary, #5b6478);
  --cg-border: var(--border-color, #dde3ee);
  --cg-surface: var(--surface-primary, #ffffff);
  --cg-bg: var(--bg-page, #f5f7fb);
  --cg-danger: #b3261e;
  --cg-danger-bg: #fdf1f0;
  --cg-danger-border: #f2c9c6;
  --cg-success: #1f6b3a;
  --cg-success-bg: #eff7f1;
  --cg-success-border: #c7e2ce;
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  padding: 0;
  color: var(--cg-text);
  font-size: 16px;
  line-height: 1.55;
}

.course-grades,
.course-grades *,
.course-grades *::before,
.course-grades *::after {
  box-sizing: border-box;
}

.course-grades [hidden] {
  display: none !important;
}

.course-grades .cg {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.course-grades .cg__header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px 24px;
}

.course-grades .cg__title {
  margin: 0;
  font-size: 1.5rem;
  line-height: 1.3;
  color: var(--cg-brand-dark);
}

.course-grades .cg__subtitle {
  margin: 6px 0 0;
  max-width: 48rem;
  color: var(--cg-muted);
  font-size: 0.9rem;
}

.course-grades .cg__badge {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  padding: 5px 14px;
  border: 1px solid var(--cg-border);
  border-radius: 999px;
  background: #ffeef3;
  color: #b83d5c;
  font-size: 0.85rem;
  font-weight: 600;
}

.course-grades .cg__form {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) auto;
  align-items: end;
  gap: 12px 16px;
  padding: 16px;
  border: 1px solid var(--cg-border);
  border-radius: 12px;
  background: var(--cg-surface);
}

.course-grades .cg__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.course-grades .cg__label {
  color: var(--cg-muted);
  font-size: 0.85rem;
  font-weight: 600;
}

.course-grades .cg__input {
  width: 100%;
  min-height: 44px;
  padding: 10px 12px;
  border: 1px solid var(--cg-border);
  border-radius: 8px;
  background: var(--cg-surface);
  color: var(--cg-text);
  font: inherit;
  font-size: 1rem;
}

.course-grades .cg__input::placeholder {
  color: #8a93a6;
}

.course-grades .cg__input:focus-visible,
.course-grades .cg__button:focus-visible {
  outline: 2px solid var(--cg-brand);
  outline-offset: 2px;
}

.course-grades .cg__input:disabled {
  background: var(--cg-bg);
  color: var(--cg-muted);
  cursor: not-allowed;
}

.course-grades .cg__actions {
  display: flex;
  gap: 10px;
}

.course-grades .cg__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 10px 20px;
  border: 1px solid var(--cg-brand);
  border-radius: 8px;
  background: var(--cg-surface);
  color: var(--cg-brand);
  font: inherit;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.course-grades .cg__button:hover:not(:disabled) {
  background: #eef1f9;
}

.course-grades .cg__button--primary {
  background: var(--cg-brand);
  color: #ffffff;
}

.course-grades .cg__button--primary:hover:not(:disabled) {
  background: var(--cg-brand-dark);
}

.course-grades .cg__button--small {
  min-height: 36px;
  padding: 6px 14px;
  font-size: 0.85rem;
}

.course-grades .cg__button:disabled {
  border-color: var(--cg-border);
  background: var(--cg-bg);
  color: #8a93a6;
  cursor: not-allowed;
}

.course-grades .cg__status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  margin: 0;
  padding: 12px 14px;
  border: 1px solid var(--cg-border);
  border-radius: 10px;
  background: var(--cg-surface);
  color: var(--cg-muted);
  font-size: 0.9rem;
  overflow-wrap: anywhere;
}

.course-grades .cg__status--success {
  border-color: var(--cg-success-border);
  background: var(--cg-success-bg);
  color: var(--cg-success);
}

.course-grades .cg__status--error {
  border-color: var(--cg-danger-border);
  background: var(--cg-danger-bg);
  color: var(--cg-danger);
}

.course-grades .cg__status--loading::before {
  content: "";
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: cg-spin 0.8s linear infinite;
}

.course-grades .cg__meta {
  margin: -4px 0 0;
  color: var(--cg-muted);
  font-size: 0.9rem;
}

.course-grades .cg__list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr));
  gap: 12px;
}

.course-grades .cg__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  padding: 14px 16px;
  border: 1px solid var(--cg-border);
  border-radius: 12px;
  background: var(--cg-surface);
  box-shadow: 0 1px 2px rgba(31, 36, 48, 0.04);
}

.course-grades .cg__item--active {
  border-color: var(--cg-brand);
  box-shadow: 0 0 0 2px rgba(43, 63, 129, 0.12);
}

.course-grades .cg__item-main {
  min-width: 0;
}

.course-grades .cg__item-title {
  margin: 0;
  color: var(--cg-brand-dark);
  font-size: 1rem;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.course-grades .cg__item-teacher {
  margin: 4px 0 0;
  color: var(--cg-muted);
  font-size: 0.85rem;
  overflow-wrap: anywhere;
}

.course-grades .cg__pagination {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}

.course-grades .cg__page-info {
  color: var(--cg-muted);
  font-size: 0.85rem;
}

.course-grades .cg__hint {
  margin: 0;
  padding: 28px 16px;
  border: 1px dashed var(--cg-border);
  border-radius: 12px;
  background: var(--cg-surface);
  color: var(--cg-muted);
  text-align: center;
}

.course-grades .cg__grade {
  padding: 18px;
  border: 1px solid var(--cg-border);
  border-radius: 12px;
  background: var(--cg-surface);
}

.course-grades .cg__grade-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px 16px;
  margin-bottom: 14px;
}

.course-grades .cg__grade-title {
  margin: 0;
  color: var(--cg-brand-dark);
  font-size: 1.1rem;
  overflow-wrap: anywhere;
}

.course-grades .cg__grade-teacher {
  margin: 0;
  color: var(--cg-muted);
  font-size: 0.85rem;
}

.course-grades .cg__stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.course-grades .cg__stat {
  padding: 12px 14px;
  border: 1px solid var(--cg-border);
  border-radius: 10px;
  background: var(--cg-bg);
}

.course-grades .cg__stat-label {
  margin: 0;
  color: var(--cg-muted);
  font-size: 0.8rem;
}

.course-grades .cg__stat-value {
  margin: 4px 0 0;
  color: var(--cg-brand-dark);
  font-size: 1.4rem;
  font-weight: 700;
  line-height: 1.2;
}

.course-grades .cg__segments {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.course-grades .cg__segment {
  display: grid;
  grid-template-columns: 7.5em minmax(0, 1fr) 6.5em;
  align-items: center;
  gap: 10px;
  font-size: 0.85rem;
}

.course-grades .cg__segment-label {
  color: var(--cg-muted);
}

.course-grades .cg__bar {
  height: 10px;
  border-radius: 999px;
  background: #eef1f7;
  overflow: hidden;
}

.course-grades .cg__bar-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--cg-brand);
}

.course-grades .cg__bar-fill--low {
  background: #c0544b;
}

.course-grades .cg__segment-value {
  color: var(--cg-text);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.course-grades .cg__extra {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  margin: 16px 0 0;
  padding-top: 14px;
  border-top: 1px dashed var(--cg-border);
  color: var(--cg-muted);
  font-size: 0.85rem;
}

.course-grades .cg__note {
  margin: 12px 0 0;
  color: var(--cg-muted);
  font-size: 0.8rem;
}

@keyframes cg-spin {
  to {
    transform: rotate(360deg);
  }
}

@container tool-page (max-width: 640px) {
  .course-grades .cg__header {
    flex-direction: column;
    align-items: flex-start;
  }

  .course-grades .cg__form {
    grid-template-columns: 1fr;
  }

  .course-grades .cg__actions .cg__button {
    width: 100%;
  }

  .course-grades .cg__list {
    grid-template-columns: 1fr;
  }

  .course-grades .cg__pagination {
    justify-content: space-between;
  }

  .course-grades .cg__segment {
    grid-template-columns: 6.5em minmax(0, 1fr) 5.5em;
  }
}

@media (prefers-reduced-motion: reduce) {
  .course-grades .cg__status--loading::before {
    animation: none;
  }
}
`;
