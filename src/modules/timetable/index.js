/**
 * AI 课表识别与周课表模块。
 *
 * Contract: mount(rootElement, context) -> unmount()
 * context: { config?: { timetableEndpoint? }, notify? }
 *
 * 流程：上传截图 → 服务端 DeepSeek 识别 → 本地校对 → 保存 → 按周查看。
 * 周次切换、单双周筛选、冲突检测与保存均在本地完成，切换周次不发起网络请求。
 */
import {
  PARITY_LABELS,
  WEEKDAY_LABELS,
  createTimetable,
  formatSections,
  formatWeekRules,
  makeCourseId,
  normalizeCourse,
  normalizeDateString,
  normalizeTotalWeeks,
  semesterLabel
} from './model.js';
import {
  computeCurrentWeek,
  coursesForWeek,
  detectConflicts,
  isMonday
} from './rules.js';
import { prepareImage, rotateImage, validateImageFile } from './image.js';
import { mapErrorHint, recognizeSchedule } from './api.js';
import {
  clearTimetable,
  exportTimetableJson,
  importTimetableJson,
  loadTimetable,
  saveTimetable
} from './storage.js';
import { TIMETABLE_STYLES } from './styles.js';

export const manifest = Object.freeze({
  id: 'timetable',
  title: 'AI 课表',
  path: '/timetable',
  description: '上传课表截图，AI 提取课程与单双周，按当前周次显示周课表'
});

const STYLE_ID = 'timetable-module-styles';
const MAX_SECTIONS = 12;

const escapeHtml = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const optionList = (from, to, selected, label = (value) => String(value)) => {
  const options = [];
  for (let value = from; value <= to; value += 1) {
    options.push(
      `<option value="${value}"${Number(selected) === value ? ' selected' : ''}>${escapeHtml(label(value))}</option>`
    );
  }
  return options.join('');
};

const parityOptions = (selected) =>
  Object.entries(PARITY_LABELS)
    .map(
      ([value, label]) =>
        `<option value="${value}"${selected === value ? ' selected' : ''}>${label}</option>`
    )
    .join('');

function hueFor(name) {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 360;
  }
  return hash;
}

function weekConflictIds(courses) {
  const ids = new Set();
  for (let i = 0; i < courses.length; i += 1) {
    for (let j = i + 1; j < courses.length; j += 1) {
      const a = courses[i];
      const b = courses[j];
      if (a.weekday !== b.weekday) continue;
      if (a.startSection > b.endSection || b.startSection > a.endSection) continue;
      ids.add(a.id);
      ids.add(b.id);
    }
  }
  return ids;
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return false;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = TIMETABLE_STYLES;
  document.head.appendChild(style);
  return true;
}

export function mount(rootElement, context = {}) {
  if (!rootElement) throw new Error('课表模块需要挂载容器');

  const createdStyle = injectStyles();
  const controller = new AbortController();
  const notify = typeof context.notify === 'function' ? context.notify : null;
  const endpoint = context.config?.timetableEndpoint || undefined;
  const signal = controller.signal;

  const saved = loadTimetable();
  const state = {
    timetable: saved || createTimetable(),
    hasSaved: Boolean(saved),
    view: saved ? 'schedule' : 'import',
    draft: null,
    draftWarnings: [],
    image: null,
    busy: false,
    week: 1,
    editing: null,
    abort: null
  };

  // 初始周次：设置开学日期时定位当前周，否则停在第一周。
  const initial = computeCurrentWeek(
    state.timetable.semester.startDate,
    state.timetable.semester.totalWeeks
  );
  state.week = initial.week || 1;

  rootElement.innerHTML = `
    <div class="timetable">
      <div class="tt-head">
        <div class="tt-head__text">
          <h2 class="tt-title">AI 课表</h2>
          <p class="tt-sub">上传课表截图，自动识别单双周与节次，并按当前周次显示</p>
        </div>
        <div class="tt-head__actions">
          <button type="button" class="tt-btn tt-btn--small" data-action="open-settings">学期设置</button>
          <button type="button" class="tt-btn tt-btn--small" data-action="import-json">导入课表</button>
          <button type="button" class="tt-btn tt-btn--small" data-action="export" ${state.hasSaved ? '' : 'disabled'}>导出课表</button>
        </div>
      </div>
      <div data-ref="body"></div>
      <p class="tt-status" data-ref="status" role="status" aria-live="polite"></p>
      <input type="file" accept="image/png,image/jpeg,image/webp" data-ref="imageInput" class="tt-visually-hidden">
      <input type="file" accept="application/json,.json" data-ref="jsonInput" class="tt-visually-hidden">

      <dialog class="tt-dialog" data-ref="editorDialog">
      <form data-ref="editorForm" novalidate>
        <div class="tt-dialog__head">
          <span class="tt-dialog__title" data-ref="editorTitle">编辑课程</span>
          <button type="button" class="tt-btn tt-btn--small" data-action="close-editor">关闭</button>
        </div>
        <div class="tt-dialog__body">
          <div class="tt-banner tt-banner--error" data-ref="editorError" hidden></div>
          <div class="tt-form-grid">
            <label class="tt-field tt-field--wide">课程名称 *<input name="courseName" maxlength="80" autocomplete="off" required></label>
            <label class="tt-field">星期 *<select name="weekday">${optionList(1, 7, 1, (value) => WEEKDAY_LABELS[value])}</select></label>
            <label class="tt-field">教师<input name="teacher" maxlength="40" autocomplete="off"></label>
            <label class="tt-field">开始节次 *<select name="startSection">${optionList(1, MAX_SECTIONS, 1)}</select></label>
            <label class="tt-field">结束节次 *<select name="endSection">${optionList(1, MAX_SECTIONS, 2)}</select></label>
            <label class="tt-field">教室<input name="classroom" maxlength="60" autocomplete="off"></label>
          </div>
          <div class="tt-rules">
            <div class="tt-rules__head">
              <span>周次规则（闭区间，可多条）</span>
              <button type="button" class="tt-btn tt-btn--small" data-action="add-rule">添加规则</button>
            </div>
            <div data-ref="ruleRows"></div>
          </div>
        </div>
        <div class="tt-dialog__foot">
          <button type="button" class="tt-btn" data-action="close-editor">取消</button>
          <button type="submit" class="tt-btn tt-btn--primary">保存课程</button>
        </div>
      </form>
    </dialog>

    <dialog class="tt-dialog" data-ref="settingsDialog">
      <form data-ref="settingsForm" novalidate>
        <div class="tt-dialog__head">
          <span class="tt-dialog__title">学期设置</span>
          <button type="button" class="tt-btn tt-btn--small" data-action="close-settings">关闭</button>
        </div>
        <div class="tt-dialog__body">
          <label class="tt-field">学期名称<input name="semesterName" maxlength="80" placeholder="例如 2026-2027学年第一学期"></label>
          <div class="tt-form-grid">
            <label class="tt-field">开学日期（第一周周一）<input type="date" name="startDate"></label>
            <label class="tt-field">学期总周数<input type="number" name="totalWeeks" min="1" max="30" step="1"></label>
          </div>
          <p class="tt-status" data-ref="settingsHint"></p>
          <div class="tt-field">
            上课时间（显示用，可修改）
            <div class="tt-periods" data-ref="periodFields"></div>
          </div>
        </div>
        <div class="tt-dialog__foot">
          <button type="button" class="tt-btn" data-action="close-settings">取消</button>
          <button type="submit" class="tt-btn tt-btn--primary">保存设置</button>
        </div>
      </form>
    </dialog>
    </div>
  `;

  const bodyEl = rootElement.querySelector('[data-ref="body"]');
  const statusEl = rootElement.querySelector('[data-ref="status"]');
  const imageInput = rootElement.querySelector('[data-ref="imageInput"]');
  const jsonInput = rootElement.querySelector('[data-ref="jsonInput"]');
  const editorDialog = rootElement.querySelector('[data-ref="editorDialog"]');
  const editorForm = rootElement.querySelector('[data-ref="editorForm"]');
  const editorTitle = rootElement.querySelector('[data-ref="editorTitle"]');
  const editorError = rootElement.querySelector('[data-ref="editorError"]');
  const ruleRows = rootElement.querySelector('[data-ref="ruleRows"]');
  const settingsDialog = rootElement.querySelector('[data-ref="settingsDialog"]');
  const settingsForm = rootElement.querySelector('[data-ref="settingsForm"]');
  const settingsHint = rootElement.querySelector('[data-ref="settingsHint"]');
  const periodFields = rootElement.querySelector('[data-ref="periodFields"]');

  let canExport = state.hasSaved;
  const exportButton = rootElement.querySelector('[data-action="export"]');

  function setStatus(text, tone = '') {
    statusEl.textContent = text || '';
    statusEl.className = `tt-status${tone ? ` is-${tone}` : ''}`;
  }

  function syncExportButton() {
    canExport = state.hasSaved;
    if (exportButton) exportButton.disabled = !canExport;
  }

  function currentWeekInfo() {
    return computeCurrentWeek(
      state.timetable.semester.startDate,
      state.timetable.semester.totalWeeks
    );
  }

  function render() {
    syncExportButton();
    if (state.view === 'schedule') renderSchedule();
    else if (state.view === 'review') renderReview();
    else renderImport();
  }

  /* ---------- 导入/识别 ---------- */

  function renderImport() {
    const image = state.image;
    const preview = image
      ? `
        <div class="tt-preview">
          <div class="tt-preview__frame">
            <img class="tt-preview__img" src="${image.dataUrl}" alt="课表截图预览">
          </div>
          <div class="tt-toolbar">
            <span class="tt-file-name">${escapeHtml(image.name || '课表截图')} · ${image.width}×${image.height}</span>
            <span class="tt-toolbar__spacer"></span>
            <button type="button" class="tt-btn tt-btn--small" data-action="pick-image">重新选择</button>
            <button type="button" class="tt-btn tt-btn--small" data-action="rotate-image" ${state.busy ? 'disabled' : ''}>旋转 90°</button>
            <button type="button" class="tt-btn tt-btn--primary" data-action="recognize" ${state.busy ? 'disabled' : ''}>
              ${state.busy ? '识别中…' : '开始识别'}
            </button>
          </div>
        </div>
      `
      : `
        <div class="tt-drop" data-action="pick-image" role="button" tabindex="0" aria-label="上传课表截图">
          <p class="tt-drop__title">上传课表截图</p>
          <p class="tt-drop__hint">支持 PNG / JPG / WebP，建议只截课表主体，避免姓名等隐私信息</p>
          <button type="button" class="tt-btn tt-btn--primary" data-action="pick-image">选择图片</button>
        </div>
      `;

    bodyEl.innerHTML = `
      <section class="tt-panel tt-import" aria-label="上传课表截图">
        <div class="tt-banner">
          图片会发送到 DeepSeek 识别课程与周次；识别结果、学期设置与周次筛选只保存在本机浏览器。
        </div>
        ${preview}
        ${state.busy ? '<div class="tt-banner">正在识别课表，通常需要几秒到几十秒…</div>' : ''}
        ${state.hasSaved ? '<div class="tt-toolbar"><button type="button" class="tt-btn" data-action="back-schedule">返回当前课表</button></div>' : ''}
      </section>
    `;
  }

  async function handleImageFile(file) {
    const error = validateImageFile(file);
    if (error) {
      setStatus(error, 'error');
      return;
    }
    setStatus('正在处理图片…');
    try {
      const prepared = await prepareImage(file);
      state.image = { ...prepared, name: file.name };
      setStatus('图片已就绪，点击“开始识别”');
      render();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : '图片处理失败', 'error');
    }
  }

  async function handleRecognize() {
    if (!state.image || state.busy) return;
    state.busy = true;
    state.abort = new AbortController();
    setStatus('正在调用 AI 识别课表…');
    render();

    const result = await recognizeSchedule(state.image.dataUrl, {
      endpoint,
      signal: state.abort.signal
    });

    state.busy = false;
    state.abort = null;

    if (!result.ok) {
      const hint = mapErrorHint(result.error.code);
      setStatus(hint || result.error.message, 'error');
      render();
      return;
    }

    const totalWeeks = state.timetable.semester.totalWeeks;
    const courses = result.data.courses
      .map((item) => normalizeCourse(item, { totalWeeks }))
      .filter(Boolean);

    if (!courses.length) {
      setStatus('未识别出课程：请裁剪到课表主体，或上传更清晰的截图', 'error');
      render();
      return;
    }

    state.draft = courses;
    state.draftWarnings = result.data.warnings;
    state.view = 'review';
    setStatus(`识别完成，共 ${courses.length} 条上课安排，请核对`, 'ok');
    render();
  }

  /* ---------- 校对 ---------- */

  function reviewConflicts() {
    return detectConflicts(state.draft || []);
  }

  function renderReview() {
    const courses = state.draft || [];
    const conflicts = reviewConflicts();
    const warnings = state.draftWarnings || [];
    const pending = courses.filter((course) => course.needsReview.length > 0).length;

    bodyEl.innerHTML = `
      <section class="tt-review" aria-label="识别结果校对">
        <div class="tt-banner">识别到 ${courses.length} 条上课安排。请核对课程名、星期、节次与周次后再保存。</div>
        ${warnings.map((warning) => `<div class="tt-banner tt-banner--warn">${escapeHtml(warning)}</div>`).join('')}
        ${pending ? `<div class="tt-banner tt-banner--warn">有 ${pending} 条记录存在待确认字段（黄色标记），请逐条检查。</div>` : ''}
        <div class="tt-review__list">
          ${courses.map((course) => renderReviewCard(course, conflicts.get(course.id))).join('')}
        </div>
        <div class="tt-actions">
          <button type="button" class="tt-btn tt-btn--primary" data-action="confirm-review">确认并生成课表</button>
          <button type="button" class="tt-btn" data-action="add-course">手动添加课程</button>
          <button type="button" class="tt-btn tt-btn--danger" data-action="discard-review">放弃本次识别</button>
        </div>
      </section>
    `;
  }

  function renderReviewCard(course, conflicts) {
    const issues = course.needsReview.length ? `· 待确认：${course.needsReview.join('、')}` : '';
    const conflictText = conflicts && conflicts.length ? conflicts.join('；') : '';
    const classes = ['tt-card'];
    if (course.needsReview.length) classes.push('tt-card--review');
    if (conflictText) classes.push('tt-card--conflict');

    return `
      <article class="${classes.join(' ')}">
        <div class="tt-card__top">
          <div>
            <p class="tt-card__name">${escapeHtml(course.courseName || '未命名课程')}</p>
            <p class="tt-card__meta">
              <span>${WEEKDAY_LABELS[course.weekday]}</span>
              <span>${escapeHtml(formatSections(course))}</span>
              <span>${escapeHtml(formatWeekRules(course.weekRules))}</span>
              ${course.teacher ? `<span>教师 ${escapeHtml(course.teacher)}</span>` : ''}
              ${course.classroom ? `<span>教室 ${escapeHtml(course.classroom)}</span>` : ''}
            </p>
          </div>
          <div class="tt-card__actions">
            <button type="button" class="tt-btn tt-btn--small" data-action="edit-draft" data-id="${escapeHtml(course.id)}">编辑</button>
            <button type="button" class="tt-btn tt-btn--small tt-btn--danger" data-action="delete-draft" data-id="${escapeHtml(course.id)}">删除</button>
          </div>
        </div>
        ${issues ? `<p class="tt-issue">${escapeHtml(issues)}</p>` : ''}
        ${conflictText ? `<p class="tt-issue">可能冲突：${escapeHtml(conflictText)}</p>` : ''}
        ${course.rawText ? `<details><summary class="tt-status">原始识别文字</summary><pre class="tt-status">${escapeHtml(course.rawText)}</pre></details>` : ''}
      </article>
    `;
  }

  function confirmReview() {
    const courses = state.draft || [];
    if (!courses.length) {
      setStatus('没有可保存的课程', 'error');
      return;
    }
    state.timetable.courses = courses;
    const result = saveTimetable(state.timetable);
    if (!result.ok) {
      setStatus(result.error, 'error');
      return;
    }
    state.hasSaved = true;
    state.view = 'schedule';
    state.draft = null;
    const info = currentWeekInfo();
    if (info.status !== 'unset') state.week = info.week;
    setStatus(`已保存 ${courses.length} 条安排`, 'ok');
    render();
  }

  /* ---------- 周课表 ---------- */

  function renderSchedule() {
    const timetable = state.timetable;
    const totalWeeks = timetable.semester.totalWeeks;
    const week = Math.min(Math.max(1, state.week), totalWeeks);
    state.week = week;
    const info = currentWeekInfo();
    const courses = coursesForWeek(timetable.courses, week);
    const conflicts = weekConflictIds(courses);
    const pendingRules = timetable.courses.filter((course) => !course.weekRules.length).length;

    const hintClass = info.status === 'ok' ? ' is-ok' : '';
    const weekOptions = optionList(1, totalWeeks, week, (value) => `第 ${value} 周`);

    bodyEl.innerHTML = `
      <section class="tt-panel" aria-label="周次选择">
        <div class="tt-weekbar">
          <div class="tt-weekbar__nav">
            <button type="button" class="tt-btn tt-btn--small" data-action="prev-week" ${week <= 1 ? 'disabled' : ''}>上一周</button>
            <select data-ref="weekSelect" aria-label="选择周次">${weekOptions}</select>
            <button type="button" class="tt-btn tt-btn--small" data-action="next-week" ${week >= totalWeeks ? 'disabled' : ''}>下一周</button>
          </div>
          <p class="tt-weekbar__hint${hintClass}">${escapeHtml(info.message)}</p>
        </div>
        <p class="tt-status">${escapeHtml(semesterLabel(timetable))} · 第 ${week} 周 · ${courses.length} 门课</p>
        ${info.status === 'unset' ? '<div class="tt-banner tt-banner--warn">在“学期设置”中填写开学日期（第一周周一）后，可自动定位当前周次。</div>' : ''}
        ${pendingRules ? `<div class="tt-banner tt-banner--warn">有 ${pendingRules} 门课程周次待确认，暂不显示；请编辑补全周次规则。</div>` : ''}
      </section>
      <section class="tt-panel" aria-label="周课表">
        ${courses.length ? renderDesktopGrid(timetable, courses, conflicts) : renderEmptyWeek(week)}
        ${courses.length ? renderMobileList(courses, conflicts) : ''}
      </section>
      <div class="tt-actions">
        <button type="button" class="tt-btn" data-action="add-course">添加课程</button>
        <button type="button" class="tt-btn" data-action="open-import">重新识别</button>
        <button type="button" class="tt-btn" data-action="export">导出课表</button>
        <button type="button" class="tt-btn" data-action="import-json">导入课表</button>
        <button type="button" class="tt-btn tt-btn--danger" data-action="clear">清除本地课表</button>
      </div>
    `;
  }

  function renderDesktopGrid(timetable, courses, conflicts) {
    const header = [
      '<div class="tt-grid__cell tt-grid__corner" style="grid-row:1;grid-column:1">节次</div>',
      ...timetable.weekdays.map(
        (day) =>
          `<div class="tt-grid__cell tt-grid__day" style="grid-row:1;grid-column:${day + 1}">${WEEKDAY_LABELS[day]}</div>`
      )
    ];

    const rails = [];
    const slots = [];
    for (const period of timetable.periods) {
      const row = period.section + 1;
      rails.push(
        `<div class="tt-grid__cell tt-grid__rail" style="grid-row:${row};grid-column:1">
          <strong>${period.section}</strong>
          <span>${escapeHtml(period.startTime)}</span>
          <span>${escapeHtml(period.endTime)}</span>
        </div>`
      );
      for (const day of timetable.weekdays) {
        slots.push(
          `<div class="tt-grid__cell tt-slot" style="grid-row:${row};grid-column:${day + 1}"></div>`
        );
      }
    }

    const cards = courses
      .filter((course) => course.startSection <= timetable.periods.length)
      .map((course) => {
        const start = course.startSection;
        const end = Math.min(course.endSection, timetable.periods.length);
        const conflict = conflicts.has(course.id) ? ' is-conflict' : '';
        const meta = [course.classroom, course.teacher].filter(Boolean).map(escapeHtml).join(' · ');
        return `
          <button type="button" class="tt-course${conflict}" data-action="edit-course" data-id="${escapeHtml(course.id)}"
            style="grid-row:${start + 1} / ${end + 2};grid-column:${course.weekday + 1};--h:${hueFor(course.courseName)}"
            aria-label="${escapeHtml(course.courseName)}，${escapeHtml(formatSections(course))}">
            <span class="tt-course__name">${escapeHtml(course.courseName)}</span>
            ${meta ? `<span class="tt-course__meta">${meta}</span>` : ''}
            <span class="tt-course__weeks">${escapeHtml(formatWeekRules(course.weekRules))}</span>
          </button>
        `;
      })
      .join('');

    return `<div class="tt-grid-wrap"><div class="tt-grid">${header.join('')}${rails.join('')}${slots.join('')}${cards}</div></div>`;
  }

  function renderMobileList(courses, conflicts) {
    const groups = [];
    for (const day of [1, 2, 3, 4, 5, 6, 7]) {
      const items = courses.filter((course) => course.weekday === day);
      if (!items.length) continue;
      groups.push(`
        <section class="tt-day">
          <div class="tt-day__head">${WEEKDAY_LABELS[day]}</div>
          <div class="tt-day__body">
            ${items
              .map((course) => {
                const meta = [
                  formatSections(course),
                  course.classroom,
                  course.teacher,
                  formatWeekRules(course.weekRules)
                ]
                  .filter(Boolean)
                  .map(escapeHtml)
                  .join(' · ');
                const conflict = conflicts.has(course.id) ? '<span class="tt-badge tt-badge--error">可能冲突</span>' : '';
                return `
                  <button type="button" class="tt-day__item" data-action="edit-course" data-id="${escapeHtml(course.id)}">
                    <span class="tt-day__name">${escapeHtml(course.courseName)} ${conflict}</span>
                    <span class="tt-day__meta">${meta}</span>
                  </button>
                `;
              })
              .join('')}
          </div>
        </section>
      `);
    }
    return `<div class="tt-mobile">${groups.join('')}</div>`;
  }

  function renderEmptyWeek(week) {
    return `
      <div class="tt-empty">
        <p class="tt-drop__title">第 ${week} 周没有课程</p>
        <p class="tt-drop__hint">可以切换其他周次，或检查课程的周次规则（单双周）是否正确。</p>
      </div>
    `;
  }

  /* ---------- 课程编辑 ---------- */

  function defaultCourse() {
    return {
      id: makeCourseId(),
      courseName: '',
      teacher: '',
      classroom: '',
      weekday: 1,
      startSection: 1,
      endSection: 2,
      weekRules: [{ from: 1, to: state.timetable.semester.totalWeeks, parity: 'all' }],
      rawText: '',
      needsReview: [],
      source: 'manual'
    };
  }

  function ruleRow(rule) {
    const totalWeeks = state.timetable.semester.totalWeeks;
    return `
      <div class="tt-rule-row" data-rule-row>
        <label class="tt-field">起始周<select name="ruleFrom">${optionList(1, totalWeeks, rule.from)}</select></label>
        <label class="tt-field">结束周<select name="ruleTo">${optionList(1, totalWeeks, rule.to)}</select></label>
        <label class="tt-field">单双周<select name="ruleParity">${parityOptions(rule.parity)}</select></label>
        <button type="button" class="tt-btn tt-btn--danger tt-btn--small" data-action="remove-rule">删除</button>
      </div>
    `;
  }

  function openEditor(course, scope) {
    state.editing = { course: { ...course }, scope };
    const dialog = editorDialog;
    editorTitle.textContent = scope === 'draft' ? '编辑识别结果' : '编辑课程';
    editorError.hidden = true;
    const form = editorForm;
    form.elements.courseName.value = course.courseName;
    form.elements.teacher.value = course.teacher || '';
    form.elements.classroom.value = course.classroom || '';
    form.elements.weekday.value = String(course.weekday);
    form.elements.startSection.value = String(course.startSection);
    form.elements.endSection.value = String(course.endSection);
    ruleRows.innerHTML = (course.weekRules.length ? course.weekRules : [{ from: 1, to: state.timetable.semester.totalWeeks, parity: 'all' }])
      .map(ruleRow)
      .join('');
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function closeEditor() {
    if (editorDialog.open) editorDialog.close();
    else editorDialog.removeAttribute('open');
    state.editing = null;
  }

  function collectRules() {
    const rows = [...ruleRows.querySelectorAll('[data-rule-row]')];
    const rules = [];
    for (const row of rows) {
      const from = Number(row.querySelector('[name="ruleFrom"]').value);
      const to = Number(row.querySelector('[name="ruleTo"]').value);
      const parity = row.querySelector('[name="ruleParity"]').value;
      if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
        return { error: '周次规则的结束周不能早于起始周' };
      }
      rules.push({ from, to, parity });
    }
    if (!rules.length) return { error: '至少需要一条周次规则' };
    return { rules };
  }

  function saveEditor(event) {
    event.preventDefault();
    if (!state.editing) return;
    const form = editorForm;
    const name = form.elements.courseName.value.trim();
    if (!name) {
      editorError.textContent = '请填写课程名称';
      editorError.hidden = false;
      return;
    }
    const startSection = Number(form.elements.startSection.value);
    const endSection = Number(form.elements.endSection.value);
    if (endSection < startSection) {
      editorError.textContent = '结束节次不能早于开始节次';
      editorError.hidden = false;
      return;
    }
    const collected = collectRules();
    if (collected.error) {
      editorError.textContent = collected.error;
      editorError.hidden = false;
      return;
    }

    const { course, scope } = state.editing;
    const updated = {
      ...course,
      courseName: name,
      teacher: form.elements.teacher.value.trim().slice(0, 40),
      classroom: form.elements.classroom.value.trim().slice(0, 60),
      weekday: Number(form.elements.weekday.value),
      startSection,
      endSection,
      weekRules: collected.rules,
      needsReview: [],
      source: course.source || 'manual'
    };

    if (scope === 'draft') {
      state.draft = (state.draft || []).map((item) => (item.id === updated.id ? updated : item));
      setStatus('已更新识别结果');
    } else {
      const exists = state.timetable.courses.some((item) => item.id === updated.id);
      state.timetable.courses = exists
        ? state.timetable.courses.map((item) => (item.id === updated.id ? updated : item))
        : [...state.timetable.courses, updated];
      state.hasSaved = true;
      saveTimetable(state.timetable);
      setStatus('课程已保存', 'ok');
    }
    closeEditor();
    render();
  }

  /* ---------- 学期设置 ---------- */

  function openSettings() {
    const semester = state.timetable.semester;
    settingsForm.elements.semesterName.value = semester.name || '';
    settingsForm.elements.startDate.value = semester.startDate || '';
    settingsForm.elements.totalWeeks.value = String(semester.totalWeeks);
    periodFields.innerHTML = state.timetable.periods
      .map(
        (period) => `
          <div class="tt-period">
            <span>第 ${period.section} 节</span>
            <input type="time" name="start-${period.section}" value="${escapeHtml(period.startTime)}" aria-label="第${period.section}节开始时间">
            <input type="time" name="end-${period.section}" value="${escapeHtml(period.endTime)}" aria-label="第${period.section}节结束时间">
          </div>
        `
      )
      .join('');
    updateSettingsHint();
    if (typeof settingsDialog.showModal === 'function') settingsDialog.showModal();
    else settingsDialog.setAttribute('open', '');
  }

  function closeSettings() {
    if (settingsDialog.open) settingsDialog.close();
    else settingsDialog.removeAttribute('open');
  }

  function updateSettingsHint() {
    const value = settingsForm.elements.startDate.value;
    if (!value) {
      settingsHint.textContent = '填写开学日期后，页面可自动定位当前周次。';
      settingsHint.className = 'tt-status';
      return;
    }
    const monday = isMonday(value);
    if (monday === false) {
      settingsHint.textContent = '该日期不是周一。开学日期应填写第一周的周一，否则当前周计算会偏移。';
      settingsHint.className = 'tt-status is-error';
      return;
    }
    settingsHint.textContent = '日期有效，将按自然周计算当前周次。';
    settingsHint.className = 'tt-status is-ok';
  }

  function saveSettings(event) {
    event.preventDefault();
    const form = settingsForm;
    const semesterName = form.elements.semesterName.value.trim().slice(0, 80);
    const startDate = normalizeDateString(form.elements.startDate.value);
    const totalWeeks = normalizeTotalWeeks(form.elements.totalWeeks.value, state.timetable.semester.totalWeeks);

    const periods = state.timetable.periods.map((period) => ({
      section: period.section,
      startTime: form.elements[`start-${period.section}`].value || period.startTime,
      endTime: form.elements[`end-${period.section}`].value || period.endTime
    }));

    state.timetable.semester = { ...state.timetable.semester, name: semesterName, startDate, totalWeeks };
    state.timetable.periods = periods;
    state.timetable.courses = state.timetable.courses.map((course) => ({
      ...course,
      weekRules: course.weekRules
        .map((rule) => ({ ...rule, to: Math.min(rule.to, totalWeeks) }))
        .filter((rule) => rule.from <= totalWeeks)
    }));

    if (state.hasSaved) saveTimetable(state.timetable);
    const info = computeCurrentWeek(startDate, totalWeeks);
    state.week = info.week || 1;
    closeSettings();
    setStatus('学期设置已保存', 'ok');
    render();
  }

  /* ---------- 导出 / 导入 / 清除 ---------- */

  function exportJson() {
    if (!state.hasSaved) {
      setStatus('还没有保存的课表', 'error');
      return;
    }
    const blob = new Blob([exportTimetableJson(state.timetable)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `课表-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus('已导出 JSON', 'ok');
  }

  async function importJsonFile(file) {
    if (!file) return;
    let text;
    try {
      text = await file.text();
    } catch {
      setStatus('读取文件失败', 'error');
      return;
    }
    const result = importTimetableJson(text);
    if (!result.ok) {
      setStatus(`导入失败：${result.error}`, 'error');
      return;
    }
    state.timetable = result.data;
    state.hasSaved = true;
    saveTimetable(state.timetable);
    state.view = 'schedule';
    state.draft = null;
    const info = currentWeekInfo();
    state.week = info.week || 1;
    setStatus(`已导入 ${state.timetable.courses.length} 条安排`, 'ok');
    render();
  }

  function clearAll() {
    if (!window.confirm('确定清除本地保存的课表吗？该操作不可撤销，建议先导出备份。')) return;
    clearTimetable();
    state.timetable = createTimetable();
    state.hasSaved = false;
    state.view = 'import';
    state.draft = null;
    state.image = null;
    state.week = 1;
    setStatus('本地课表已清除');
    render();
  }

  /* ---------- 事件 ---------- */

  bodyEl.addEventListener(
    'click',
    (event) => {
      const target = event.target.closest('[data-action]');
      if (!target || !bodyEl.contains(target)) return;
      const action = target.dataset.action;
      const id = target.dataset.id;

      switch (action) {
        case 'pick-image':
          event.preventDefault();
          imageInput.click();
          break;
        case 'rotate-image':
          if (!state.image) return;
          rotateImage(state.image.dataUrl, 90)
            .then((dataUrl) => {
              state.image = { ...state.image, dataUrl };
              render();
            })
            .catch(() => setStatus('旋转失败，请重新上传图片', 'error'));
          break;
        case 'recognize':
          handleRecognize();
          break;
        case 'back-schedule':
          state.view = 'schedule';
          render();
          break;
        case 'edit-draft':
          {
            const course = (state.draft || []).find((item) => item.id === id);
            if (course) openEditor(course, 'draft');
          }
          break;
        case 'delete-draft':
          state.draft = (state.draft || []).filter((item) => item.id !== id);
          setStatus('已删除该条识别结果');
          render();
          break;
        case 'add-course':
          openEditor(defaultCourse(), state.view === 'review' ? 'draft' : 'schedule');
          break;
        case 'confirm-review':
          confirmReview();
          break;
        case 'discard-review':
          if (!window.confirm('放弃本次识别结果？已保存的课表不会受影响。')) return;
          state.draft = null;
          state.draftWarnings = [];
          state.image = null;
          state.view = state.hasSaved ? 'schedule' : 'import';
          setStatus('已放弃本次识别');
          render();
          break;
        case 'prev-week':
          state.week = Math.max(1, state.week - 1);
          render();
          break;
        case 'next-week':
          state.week = Math.min(state.timetable.semester.totalWeeks, state.week + 1);
          render();
          break;
        case 'edit-course':
          {
            const course = state.timetable.courses.find((item) => item.id === id);
            if (course) openEditor(course, 'schedule');
          }
          break;
        case 'open-import':
          state.view = 'import';
          render();
          break;
        case 'export':
          exportJson();
          break;
        case 'import-json':
          jsonInput.click();
          break;
        case 'clear':
          clearAll();
          break;
        default:
          break;
      }
    },
    { signal }
  );

  bodyEl.addEventListener(
    'change',
    (event) => {
      if (event.target.matches('[data-ref="weekSelect"]')) {
        state.week = Number(event.target.value);
        render();
      }
    },
    { signal }
  );

  imageInput.addEventListener(
    'change',
    () => {
      const file = imageInput.files?.[0];
      imageInput.value = '';
      if (file) handleImageFile(file);
    },
    { signal }
  );

  jsonInput.addEventListener(
    'change',
    () => {
      const file = jsonInput.files?.[0];
      jsonInput.value = '';
      if (file) importJsonFile(file);
    },
    { signal }
  );

  const dropZone = () => bodyEl.querySelector('.tt-drop');
  bodyEl.addEventListener(
    'dragover',
    (event) => {
      const zone = dropZone();
      if (!zone) return;
      event.preventDefault();
      zone.classList.add('is-drag');
    },
    { signal }
  );
  bodyEl.addEventListener(
    'dragleave',
    () => dropZone()?.classList.remove('is-drag'),
    { signal }
  );
  bodyEl.addEventListener(
    'drop',
    (event) => {
      const zone = dropZone();
      if (!zone) return;
      event.preventDefault();
      zone.classList.remove('is-drag');
      const file = event.dataTransfer?.files?.[0];
      if (file) handleImageFile(file);
    },
    { signal }
  );

  editorForm.addEventListener('submit', saveEditor, { signal });
  editorDialog.addEventListener(
    'click',
    (event) => {
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (action === 'close-editor') closeEditor();
      if (action === 'add-rule') {
        ruleRows.insertAdjacentHTML(
          'beforeend',
          ruleRow({ from: 1, to: state.timetable.semester.totalWeeks, parity: 'all' })
        );
      }
      if (action === 'remove-rule') {
        if (ruleRows.querySelectorAll('[data-rule-row]').length <= 1) {
          editorError.textContent = '至少保留一条周次规则';
          editorError.hidden = false;
          return;
        }
        event.target.closest('[data-rule-row]')?.remove();
      }
    },
    { signal }
  );

  settingsForm.addEventListener('submit', saveSettings, { signal });
  settingsForm.elements.startDate.addEventListener('change', updateSettingsHint, { signal });
  settingsDialog.addEventListener(
    'click',
    (event) => {
      if (event.target.closest('[data-action="close-settings"]')) closeSettings();
    },
    { signal }
  );

  rootElement.querySelector('[data-action="open-settings"]').addEventListener(
    'click',
    openSettings,
    { signal }
  );
  rootElement.querySelector('[data-action="import-json"]').addEventListener(
    'click',
    () => jsonInput.click(),
    { signal }
  );
  rootElement.querySelector('[data-action="export"]').addEventListener('click', exportJson, {
    signal
  });

  render();
  if (state.view === 'schedule') {
    const info = currentWeekInfo();
    if (info.status !== 'ok') setStatus(info.message);
  }

  const unmount = () => {
    controller.abort();
    if (state.abort) state.abort.abort();
    if (createdStyle) document.getElementById(STYLE_ID)?.remove();
    rootElement.innerHTML = '';
  };
  unmount.unmount = unmount;
  return unmount;
}

export default mount;
