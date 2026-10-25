export const TERM_COURSE_LIST_STYLES = `
.term-course-list {
  --tcl-brand: var(--brand-primary, #2b3f81);
  --tcl-brand-dark: var(--brand-primary-dark, #1f2f63);
  --tcl-text: var(--text-primary, #1f2430);
  --tcl-muted: var(--text-secondary, #5b6478);
  --tcl-border: var(--border-color, #dde3ee);
  --tcl-surface: var(--surface-primary, #ffffff);
  --tcl-bg: var(--bg-page, #f5f7fb);
  --tcl-danger: #b3261e;
  --tcl-danger-bg: #fdf1f0;
  --tcl-danger-border: #f2c9c6;
  --tcl-success: #1f6b3a;
  --tcl-success-bg: #eff7f1;
  --tcl-success-border: #c7e2ce;
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px 16px 40px;
  color: var(--tcl-text);
  font-size: 16px;
  line-height: 1.55;
}

.term-course-list,
.term-course-list *,
.term-course-list *::before,
.term-course-list *::after {
  box-sizing: border-box;
}

.term-course-list .tcl {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.term-course-list .tcl__header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px 24px;
}

.term-course-list .tcl__title {
  margin: 0;
  font-size: 1.5rem;
  line-height: 1.3;
  color: var(--tcl-brand-dark);
}

.term-course-list .tcl__subtitle {
  margin: 6px 0 0;
  max-width: 46rem;
  color: var(--tcl-muted);
  font-size: 0.9rem;
}

.term-course-list .tcl__term-badge {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  padding: 5px 14px;
  border: 1px solid var(--tcl-border);
  border-radius: 999px;
  background: #e9edf7;
  color: var(--tcl-brand);
  font-size: 0.85rem;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.term-course-list .tcl__form {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) auto;
  align-items: end;
  gap: 12px 16px;
  padding: 16px;
  border: 1px solid var(--tcl-border);
  border-radius: 12px;
  background: var(--tcl-surface);
}

.term-course-list .tcl__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.term-course-list .tcl__field--search {
  max-width: 420px;
}

.term-course-list .tcl__label {
  color: var(--tcl-muted);
  font-size: 0.85rem;
  font-weight: 600;
}

.term-course-list .tcl__input {
  width: 100%;
  min-height: 44px;
  padding: 10px 12px;
  border: 1px solid var(--tcl-border);
  border-radius: 8px;
  background: var(--tcl-surface);
  color: var(--tcl-text);
  font: inherit;
  font-size: 1rem;
}

.term-course-list .tcl__input::placeholder {
  color: #8a93a6;
}

.term-course-list .tcl__input:focus-visible,
.term-course-list .tcl__button:focus-visible {
  outline: 2px solid var(--tcl-brand);
  outline-offset: 2px;
}

.term-course-list .tcl__input:disabled {
  background: var(--tcl-bg);
  color: var(--tcl-muted);
  cursor: not-allowed;
}

.term-course-list .tcl__actions {
  display: flex;
  gap: 10px;
}

.term-course-list .tcl__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 10px 20px;
  border: 1px solid var(--tcl-brand);
  border-radius: 8px;
  background: var(--tcl-surface);
  color: var(--tcl-brand);
  font: inherit;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.term-course-list .tcl__button:hover:not(:disabled) {
  background: #eef1f9;
}

.term-course-list .tcl__button--primary {
  background: var(--tcl-brand);
  color: #ffffff;
}

.term-course-list .tcl__button--primary:hover:not(:disabled) {
  background: var(--tcl-brand-dark);
}

.term-course-list .tcl__button--small {
  min-height: 40px;
  padding: 8px 16px;
  font-size: 0.875rem;
}

.term-course-list .tcl__button:disabled {
  border-color: var(--tcl-border);
  background: var(--tcl-bg);
  color: #8a93a6;
  cursor: not-allowed;
}

.term-course-list .tcl__toolbar {
  display: flex;
  justify-content: flex-end;
}

.term-course-list .tcl__status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  margin: 0;
  padding: 12px 14px;
  border: 1px solid var(--tcl-border);
  border-radius: 10px;
  background: var(--tcl-surface);
  color: var(--tcl-muted);
  font-size: 0.9rem;
  overflow-wrap: anywhere;
}

.term-course-list .tcl__status--success {
  border-color: var(--tcl-success-border);
  background: var(--tcl-success-bg);
  color: var(--tcl-success);
}

.term-course-list .tcl__status--error {
  border-color: var(--tcl-danger-border);
  background: var(--tcl-danger-bg);
  color: var(--tcl-danger);
}

.term-course-list .tcl__status--loading::before {
  content: "";
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: tcl-spin 0.8s linear infinite;
}

.term-course-list .tcl__meta {
  margin: -4px 0 0;
  color: var(--tcl-muted);
  font-size: 0.9rem;
}

.term-course-list .tcl__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
}

.term-course-list .tcl__card {
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--tcl-border);
  border-radius: 12px;
  background: var(--tcl-surface);
  box-shadow: 0 1px 2px rgba(31, 36, 48, 0.04);
}

.term-course-list .tcl__card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}

.term-course-list .tcl__card-title {
  margin: 0;
  min-width: 0;
  color: var(--tcl-brand-dark);
  font-size: 1.05rem;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.term-course-list .tcl__details {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
}

.term-course-list .tcl__row {
  display: grid;
  grid-template-columns: 4.5em minmax(0, 1fr);
  gap: 8px;
  margin: 0;
}

.term-course-list .tcl__row dt {
  color: var(--tcl-muted);
  font-size: 0.85rem;
}

.term-course-list .tcl__row dd {
  margin: 0;
  min-width: 0;
  font-size: 0.92rem;
  overflow-wrap: anywhere;
}

.term-course-list .tcl__row--schedule dd {
  white-space: pre-wrap;
}

.term-course-list .tcl__hint {
  margin: 0;
  padding: 28px 16px;
  border: 1px dashed var(--tcl-border);
  border-radius: 12px;
  background: var(--tcl-surface);
  color: var(--tcl-muted);
  text-align: center;
}

@keyframes tcl-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 640px) {
  .term-course-list {
    padding: 16px 16px 32px;
  }

  .term-course-list .tcl__header {
    flex-direction: column;
    align-items: flex-start;
  }

  .term-course-list .tcl__form {
    grid-template-columns: 1fr;
  }

  .term-course-list .tcl__actions {
    flex-direction: column;
  }

  .term-course-list .tcl__actions .tcl__button {
    width: 100%;
  }

  .term-course-list .tcl__field--search {
    max-width: none;
  }

  .term-course-list .tcl__toolbar {
    justify-content: stretch;
  }

  .term-course-list .tcl__grid {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .term-course-list .tcl__status--loading::before {
    animation: none;
  }
}
`;
