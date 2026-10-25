/** 课表模块样式，全部限定在 `.timetable` 下，复用主站设计变量。 */
export const TIMETABLE_STYLES = `
.timetable {
  --tt-brand: var(--brand, #2b3f81);
  --tt-border: var(--border, #dde3ef);
  --tt-muted: var(--text-muted, #5f6b82);
  --tt-surface: var(--surface, #fff);
  display: grid;
  gap: 18px;
  color: var(--text, #1c2434);
}
.timetable h2, .timetable h3, .timetable p { margin: 0; }
.timetable pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-family: inherit; }
.timetable button { font-family: inherit; }
.timetable .tt-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
.timetable .tt-head__text { display: grid; gap: 6px; }
.timetable .tt-title { font-size: 26px; line-height: 1.2; }
.timetable .tt-sub { color: var(--tt-muted); font-size: 14px; }
.timetable .tt-head__actions { display: flex; gap: 8px; flex-wrap: wrap; }
.timetable .tt-btn {
  appearance: none; border: 1px solid var(--tt-border); background: var(--tt-surface);
  color: var(--text, #1c2434); border-radius: 10px; padding: 9px 14px; font-size: 14px;
  cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  min-height: 40px; transition: background .15s, border-color .15s, box-shadow .15s;
}
.timetable .tt-btn:hover { border-color: #b9c4dd; background: #f7f9ff; }
.timetable .tt-btn:disabled { opacity: .55; cursor: not-allowed; }
.timetable .tt-btn--primary { background: var(--tt-brand); border-color: var(--tt-brand); color: #fff; }
.timetable .tt-btn--primary:hover { background: var(--brand-strong, #1f2f63); border-color: var(--brand-strong, #1f2f63); }
.timetable .tt-btn--danger { border-color: #e3b4b4; color: var(--danger, #a12b2b); background: #fff; }
.timetable .tt-btn--danger:hover { background: var(--danger-bg, #fdf1f1); }
.timetable .tt-btn--small { min-height: 32px; padding: 4px 10px; font-size: 13px; }

.timetable .tt-banner { border-radius: 12px; padding: 12px 14px; font-size: 13px; line-height: 1.55; border: 1px solid var(--tt-border); background: #f7f9ff; color: #33405c; }
.timetable .tt-banner--warn { border-color: #f0d9a8; background: var(--warning-bg, #fff8e6); color: var(--warning, #8a5a00); }
.timetable .tt-banner--error { border-color: #f0c3c3; background: var(--danger-bg, #fdf1f1); color: var(--danger, #a12b2b); }
.timetable .tt-banner--ok { border-color: #bfe0c9; background: #f1faf4; color: #1e5c33; }

.timetable .tt-panel { background: var(--tt-surface); border: 1px solid var(--tt-border); border-radius: var(--radius, 14px); padding: 18px; box-shadow: var(--shadow, 0 10px 30px rgba(35,52,96,.08)); }
.timetable .tt-import { display: grid; gap: 14px; }
.timetable .tt-drop {
  border: 1.5px dashed #b9c4dd; border-radius: 14px; padding: 26px 18px; text-align: center;
  display: grid; gap: 8px; justify-items: center; background: #fbfcff;
}
.timetable .tt-drop.is-drag { border-color: var(--tt-brand); background: var(--brand-soft, #eef1f9); }
.timetable .tt-drop__title { font-size: 16px; font-weight: 600; }
.timetable .tt-drop__hint { color: var(--tt-muted); font-size: 13px; }
.timetable .tt-preview { display: grid; gap: 12px; }
.timetable .tt-preview__frame { position: relative; border: 1px solid var(--tt-border); border-radius: 12px; overflow: hidden; background: #f3f5fa; max-height: 460px; display: grid; place-items: center; }
.timetable .tt-preview__img { max-width: 100%; max-height: 460px; display: block; }
.timetable .tt-toolbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.timetable .tt-toolbar__spacer { flex: 1; }
.timetable .tt-file-name { color: var(--tt-muted); font-size: 13px; overflow-wrap: anywhere; }
.timetable .tt-status { font-size: 13px; color: var(--tt-muted); min-height: 20px; }
.timetable .tt-status.is-error { color: var(--danger, #a12b2b); }
.timetable .tt-status.is-ok { color: #1e5c33; }

.timetable .tt-review { display: grid; gap: 14px; }
.timetable .tt-review__list { display: grid; gap: 10px; }
.timetable .tt-card { border: 1px solid var(--tt-border); border-radius: 12px; padding: 12px 14px; display: grid; gap: 8px; background: #fff; }
.timetable .tt-card--review { border-left: 3px solid #e2a33a; }
.timetable .tt-card--conflict { border-left: 3px solid #c95050; }
.timetable .tt-card__top { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; flex-wrap: wrap; }
.timetable .tt-card__name { font-weight: 600; font-size: 15px; }
.timetable .tt-card__meta { color: var(--tt-muted); font-size: 13px; display: flex; flex-wrap: wrap; gap: 4px 14px; }
.timetable .tt-card__actions { display: flex; gap: 6px; }
.timetable .tt-badge { display: inline-block; border-radius: 999px; padding: 1px 8px; font-size: 12px; background: var(--brand-soft, #eef1f9); color: var(--tt-brand); }
.timetable .tt-badge--warn { background: var(--warning-bg, #fff8e6); color: var(--warning, #8a5a00); }
.timetable .tt-badge--error { background: var(--danger-bg, #fdf1f1); color: var(--danger, #a12b2b); }
.timetable .tt-issue { font-size: 12px; color: var(--warning, #8a5a00); }

.timetable .tt-weekbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.timetable .tt-weekbar__nav { display: flex; align-items: center; gap: 8px; }
.timetable .tt-weekbar select { min-height: 40px; border-radius: 10px; border: 1px solid var(--tt-border); padding: 6px 10px; background: #fff; font-size: 14px; }
.timetable .tt-weekbar__hint { color: var(--tt-muted); font-size: 13px; }
.timetable .tt-weekbar__hint.is-ok { color: #1e5c33; }

.timetable .tt-grid-wrap { overflow-x: auto; }
.timetable .tt-grid {
  display: grid; min-width: 820px;
  grid-template-columns: 72px repeat(7, minmax(96px, 1fr));
  grid-auto-rows: minmax(58px, auto);
  border: 1px solid var(--tt-border); border-radius: 12px; overflow: hidden; background: #fff;
}
.timetable .tt-grid__cell { border-right: 1px solid var(--tt-border); border-bottom: 1px solid var(--tt-border); padding: 4px 6px; font-size: 13px; }
.timetable .tt-grid__corner, .timetable .tt-grid__day { background: #f4f7fd; font-weight: 600; text-align: center; padding: 8px 4px; font-size: 13px; }
.timetable .tt-grid__rail { background: #fafbfe; display: grid; align-content: center; gap: 2px; text-align: center; color: var(--tt-muted); font-size: 12px; line-height: 1.3; }
.timetable .tt-grid__rail strong { color: var(--text, #1c2434); font-size: 13px; }
.timetable .tt-slot { position: relative; }
.timetable .tt-course {
  position: relative; z-index: 1; margin: 2px; padding: 6px 7px; border-radius: 9px;
  background: hsl(var(--h, 220) 72% 94%); border: 1px solid hsl(var(--h, 220) 45% 82%);
  color: #1c2434; text-align: left; cursor: pointer; display: grid; gap: 2px;
  font-size: 12px; line-height: 1.35; overflow: hidden; min-height: 100%;
}
.timetable .tt-course:hover { box-shadow: 0 4px 12px rgba(35,52,96,.14); }
.timetable .tt-course__name { font-weight: 600; font-size: 13px; }
.timetable .tt-course__meta { color: #3d4a63; overflow-wrap: anywhere; }
.timetable .tt-course__weeks { color: #5f6b82; font-size: 11px; }
.timetable .tt-course.is-conflict { border-color: #c95050; box-shadow: inset 0 0 0 1px #c95050; }

.timetable .tt-mobile { display: none; }
.timetable .tt-day { border: 1px solid var(--tt-border); border-radius: 12px; overflow: hidden; background: #fff; }
.timetable .tt-day + .tt-day { margin-top: 10px; }
.timetable .tt-day__head { background: #f4f7fd; padding: 8px 12px; font-weight: 600; font-size: 14px; }
.timetable .tt-day__body { display: grid; }
.timetable .tt-day__item { display: grid; gap: 3px; padding: 10px 12px; border-top: 1px solid #eef1f7; text-align: left; background: none; border-left: 0; border-right: 0; border-bottom: 0; cursor: pointer; font-size: 13px; }
.timetable .tt-day__item:hover { background: #fafbff; }
.timetable .tt-day__name { font-weight: 600; font-size: 14px; }
.timetable .tt-day__meta { color: var(--tt-muted); font-size: 12px; }

.timetable .tt-empty { text-align: center; padding: 36px 16px; color: var(--tt-muted); display: grid; gap: 10px; justify-items: center; }
.timetable .tt-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }

.timetable .tt-dialog { border: none; border-radius: 16px; padding: 0; width: min(640px, calc(100vw - 32px)); box-shadow: 0 24px 60px rgba(20,30,60,.28); }
.timetable .tt-dialog::backdrop { background: rgba(20,28,52,.42); }
.timetable .tt-dialog__head { display: flex; justify-content: space-between; align-items: center; padding: 16px 18px; border-bottom: 1px solid var(--tt-border); }
.timetable .tt-dialog__title { font-size: 17px; font-weight: 600; }
.timetable .tt-dialog__body { padding: 18px; display: grid; gap: 14px; max-height: min(70vh, 620px); overflow: auto; }
.timetable .tt-dialog__foot { padding: 14px 18px; border-top: 1px solid var(--tt-border); display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
.timetable .tt-form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.timetable .tt-field { display: grid; gap: 5px; font-size: 13px; color: var(--tt-muted); }
.timetable .tt-field > input, .timetable .tt-field > select {
  min-height: 38px; border: 1px solid var(--tt-border); border-radius: 9px; padding: 7px 9px;
  font-size: 14px; color: var(--text, #1c2434); background: #fff;
}
.timetable .tt-field--wide { grid-column: 1 / -1; }
.timetable .tt-rules { display: grid; gap: 8px; }
.timetable .tt-rule-row { display: grid; grid-template-columns: 1fr 1fr 1.2fr auto; gap: 8px; align-items: end; }
.timetable .tt-rules__head { display: flex; justify-content: space-between; align-items: center; font-size: 13px; color: var(--tt-muted); }
.timetable .tt-periods { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
.timetable .tt-period { display: grid; grid-template-columns: auto 1fr 1fr; gap: 6px; align-items: center; font-size: 12px; color: var(--tt-muted); }
.timetable .tt-period input { min-height: 32px; border: 1px solid var(--tt-border); border-radius: 8px; padding: 4px 6px; font-size: 13px; width: 100%; }
.timetable .tt-visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

@media (max-width: 820px) {
  .timetable .tt-grid-wrap { display: none; }
  .timetable .tt-mobile { display: block; }
  .timetable .tt-head { flex-direction: column; align-items: stretch; }
  .timetable .tt-form-grid { grid-template-columns: 1fr; }
  .timetable .tt-rule-row { grid-template-columns: 1fr 1fr; }
  .timetable .tt-rule-row .tt-btn { grid-column: 1 / -1; }
}
@media (prefers-reduced-motion: reduce) {
  .timetable .tt-btn, .timetable .tt-course { transition: none; }
}
`;
