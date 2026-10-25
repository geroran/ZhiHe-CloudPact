/**
 * 空教室查询模块。
 *
 * Contract: mount(rootElement, context) -> unmount()
 * context: { api?: { request(path, options) }, notify?, navigate?, config? }
 *
 * 真实接口：GET /hiagent/api/options、POST /hiagent/api/query（上游 agent-server.ynu.edu.cn）。
 * 主站需要把 /hiagent 反代到上游，或注入直接请求上游的 context.api；
 * 选项接口失败时模块只显示失败状态并禁用查询，不使用内置选项兜底。
 */
import { createEmptyClassroomApi, createRequester } from './api.js';
import { createEmptyClassroomController } from './controller.js';
import { WEEKDAY_LABELS } from './logic.js';
import { EMPTY_CLASSROOM_STYLES } from './styles.js';

export const manifest = Object.freeze({
  id: 'empty-classroom',
  title: '空教室查询',
  path: '/empty-classroom',
  description: '按校区、教学周、星期与节次查询实时空教室，结果按教学楼分组并支持本地筛选',
});

const MARKUP = `
<div class="ec-hero">
  <div class="ec-hero__main">
    <span class="ec-logo">
      <img class="ec-logo__image" src="https://www.ynu.edu.cn/images/logo0430.png" alt="云南大学">
    </span>
    <div>
      <h2 class="ec-title">空教室查询</h2>
      <p class="ec-term" data-ref="term">正在读取学期信息…</p>
    </div>
  </div>
  <p class="ec-hint">选择校区、教学周、星期与节次，查询同时段无排课的教室。</p>
</div>

<div class="ec-alert" data-ref="optionsAlert" role="alert" hidden>
  <div class="ec-alert__text" data-ref="optionsErrorText"></div>
  <button type="button" class="ec-btn ec-btn--ghost" data-action="retry-options">重试选项接口</button>
</div>

<form class="ec-panel" data-ref="form" novalidate>
  <div class="ec-grid">
    <label class="ec-field">
      <span>校区</span>
      <select data-field="campus" disabled></select>
    </label>
    <label class="ec-field">
      <span>教学周</span>
      <select data-field="week" disabled></select>
    </label>
    <label class="ec-field">
      <span>星期</span>
      <select data-field="day" disabled></select>
    </label>
    <label class="ec-field">
      <span>教学楼</span>
      <select data-field="building" disabled></select>
    </label>
  </div>

  <fieldset class="ec-sections" data-ref="sectionsFieldset" disabled>
    <legend>节次（至少一节，多选表示这些节次同时空闲）</legend>
    <div class="ec-presets" role="group" aria-label="常用节次">
      <button type="button" class="ec-preset" data-preset="1,2">1-2 节</button>
      <button type="button" class="ec-preset" data-preset="3,4">3-4 节</button>
      <button type="button" class="ec-preset" data-preset="5,6">5-6 节</button>
      <button type="button" class="ec-preset" data-preset="7,8">7-8 节</button>
      <button type="button" class="ec-preset" data-preset="9,10">9-10 节</button>
      <button type="button" class="ec-preset" data-preset="11,12">11-12 节</button>
    </div>
    <div class="ec-section-grid" data-ref="sectionGrid"></div>
  </fieldset>

  <div class="ec-actions">
    <button type="submit" class="ec-btn ec-btn--primary" data-ref="queryBtn" disabled>查询空教室</button>
    <p class="ec-status" data-ref="status" role="status" aria-live="polite">正在加载查询选项…</p>
  </div>
</form>

<section class="ec-results">
  <header class="ec-results__head">
    <div>
      <h3>查询结果</h3>
      <p class="ec-summary" data-ref="summary">尚未查询</p>
    </div>
    <span class="ec-count" data-ref="count" hidden></span>
  </header>

  <div class="ec-filters" data-ref="filters">
    <label class="ec-filter">
      <span>关键词</span>
      <input type="search" data-filter="keyword" placeholder="教室名称或编号" autocomplete="off" disabled>
    </label>
    <label class="ec-filter ec-filter--seats">
      <span>最少座位</span>
      <input type="number" data-filter="minSeats" min="1" step="1" inputmode="numeric" placeholder="不限" disabled>
    </label>
    <label class="ec-check">
      <input type="checkbox" data-filter="borrowableOnly" disabled>
      <span>只看可借用</span>
    </label>
    <button type="button" class="ec-btn ec-btn--ghost" data-action="reset-filters" disabled>清除筛选</button>
  </div>

  <div class="ec-results__body" data-ref="resultsBody">
    <div class="ec-state">正在加载查询选项…</div>
  </div>
</section>

<footer class="ec-footer">
  <p>本页查询数据由云南大学信息技术中心提供</p>
  <p>页面问题或建议：yangc@stu.ynu.edu.cn</p>
</footer>
`;

function statusInfo(state, controller) {
  if (state.optionsStatus === 'error') {
    return {
      tone: 'error',
      text: `选项接口失败：${state.optionsError}。请重试选项接口后再查询。`,
    };
  }
  if (state.optionsStatus !== 'ready') {
    return { tone: 'busy', text: '正在加载查询选项…' };
  }
  if (state.queryValidationError) {
    return { tone: 'error', text: state.queryValidationError };
  }
  if (state.queryStatus === 'loading') {
    return { tone: 'busy', text: '正在查询空教室…' };
  }
  if (state.queryStatus === 'error') {
    return { tone: 'error', text: `查询失败：${state.queryError}` };
  }
  if (state.queryStatus === 'success') {
    if (state.returnedCount === 0) {
      return { tone: '', text: '查询完成，该条件下暂无空教室。' };
    }
    const counts = controller.getCounts();
    if (controller.isFiltering()) {
      return { tone: 'ok', text: `查询完成，已返回 ${counts.total} 间空教室，筛选后 ${counts.visible} 间。` };
    }
    return { tone: 'ok', text: `查询完成，已返回 ${counts.total} 间空教室。` };
  }
  return { tone: '', text: '请选择条件后查询。' };
}

export function mount(root, context = {}) {
  if (!root || typeof root.appendChild !== 'function' || !root.ownerDocument) {
    throw new TypeError('mount 需要一个 DOM 根节点');
  }

  const doc = root.ownerDocument;
  const styleEl = doc.createElement('style');
  styleEl.setAttribute('data-module', 'empty-classroom');
  styleEl.textContent = EMPTY_CLASSROOM_STYLES;

  root.classList.add('empty-classroom');
  root.setAttribute('data-module', manifest.id);
  root.innerHTML = MARKUP;
  root.prepend(styleEl);

  const refs = new Map();
  for (const element of root.querySelectorAll('[data-ref]')) {
    refs.set(element.dataset.ref, element);
  }

  function ref(name) {
    const element = refs.get(name);
    if (!element) throw new Error(`空教室模块缺少节点：${name}`);
    return element;
  }

  const form = ref('form');
  const term = ref('term');
  const optionsAlert = ref('optionsAlert');
  const optionsErrorText = ref('optionsErrorText');
  const sectionsFieldset = ref('sectionsFieldset');
  const sectionGrid = ref('sectionGrid');
  const queryBtn = ref('queryBtn');
  const status = ref('status');
  const summary = ref('summary');
  const count = ref('count');
  const filters = ref('filters');
  const resultsBody = ref('resultsBody');

  const campusSelect = root.querySelector('[data-field="campus"]');
  const weekSelect = root.querySelector('[data-field="week"]');
  const daySelect = root.querySelector('[data-field="day"]');
  const buildingSelect = root.querySelector('[data-field="building"]');
  const keywordInput = root.querySelector('[data-filter="keyword"]');
  const minSeatsInput = root.querySelector('[data-filter="minSeats"]');
  const borrowableInput = root.querySelector('[data-filter="borrowableOnly"]');

  for (let section = 1; section <= 12; section += 1) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'ec-section';
    button.dataset.section = String(section);
    button.textContent = String(section);
    button.setAttribute('aria-label', `第 ${section} 节`);
    button.setAttribute('aria-pressed', 'false');
    sectionGrid.appendChild(button);
  }

  const api = createEmptyClassroomApi(createRequester(context));
  const controller = createEmptyClassroomController({ api });

  let renderedOptions = null;

  function setSelect(select, items) {
    select.replaceChildren();
    for (const item of items) {
      const option = doc.createElement('option');
      option.value = item.value;
      option.textContent = item.label;
      select.appendChild(option);
    }
  }

  function buildOptions() {
    const options = controller.getState().options;
    setSelect(
      campusSelect,
      options.campuses.map((name) => ({ value: name, label: name })),
    );
    setSelect(
      weekSelect,
      Array.from({ length: options.maxWeek }, (_, index) => ({
        value: String(index + 1),
        label: `第 ${index + 1} 周`,
      })),
    );
    setSelect(
      daySelect,
      WEEKDAY_LABELS.map((label, index) => ({ value: String(index + 1), label })),
    );
    setSelect(buildingSelect, [
      { value: '', label: '全部教学楼' },
      ...options.buildings.map((name) => ({ value: name, label: name })),
    ]);
  }

  function clearSelects() {
    campusSelect.replaceChildren();
    weekSelect.replaceChildren();
    daySelect.replaceChildren();
    buildingSelect.replaceChildren();
    renderedOptions = null;
  }

  function renderSelects(state) {
    const ready = state.optionsStatus === 'ready' && Boolean(state.options);
    campusSelect.disabled = !ready;
    weekSelect.disabled = !ready;
    daySelect.disabled = !ready;
    buildingSelect.disabled = !ready;

    if (!ready) {
      clearSelects();
      return;
    }

    if (state.options !== renderedOptions) {
      buildOptions();
      renderedOptions = state.options;
    }

    campusSelect.value = state.selection.campus;
    weekSelect.value = String(state.selection.week);
    daySelect.value = String(state.selection.day);
    buildingSelect.value = state.selection.building;
  }

  function renderSections(state) {
    const ready = state.optionsStatus === 'ready' && Boolean(state.options);
    sectionsFieldset.disabled = !ready;
    const selected = state.selection.sections;

    for (const button of sectionGrid.querySelectorAll('[data-section]')) {
      const value = Number(button.dataset.section);
      const active = selected.includes(value);
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }

    for (const button of root.querySelectorAll('[data-preset]')) {
      const preset = button.dataset.preset.split(',').map(Number);
      const active =
        preset.length === selected.length && preset.every((value) => selected.includes(value));
      button.classList.toggle('is-active', active);
    }
  }

  function renderStatus(state) {
    const info = statusInfo(state, controller);
    status.textContent = info.text;
    status.className = info.tone ? `ec-status is-${info.tone}` : 'ec-status';
  }

  function renderActions(state) {
    queryBtn.disabled = !controller.canQuery() || state.queryStatus === 'loading';
    queryBtn.textContent = state.queryStatus === 'loading' ? '查询中…' : '查询空教室';
  }

  function syncValue(input, value) {
    if (doc.activeElement !== input && input.value !== value) input.value = value;
  }

  function renderFilters(state) {
    const enabled = state.queryStatus === 'success' && state.returnedCount > 0;
    keywordInput.disabled = !enabled;
    minSeatsInput.disabled = !enabled;
    borrowableInput.disabled = !enabled;

    syncValue(keywordInput, state.filters.keyword);
    syncValue(minSeatsInput, state.filters.minSeats);
    if (borrowableInput.checked !== state.filters.borrowableOnly) {
      borrowableInput.checked = state.filters.borrowableOnly;
    }

    const resetButton = root.querySelector('[data-action="reset-filters"]');
    resetButton.disabled = !enabled || !controller.isFiltering();
  }

  function renderHead(state) {
    summary.textContent = controller.getQueryDescription();
    const showCount = state.queryStatus === 'success' && state.returnedCount > 0;
    count.hidden = !showCount;
    if (showCount) {
      const counts = controller.getCounts();
      count.textContent = controller.isFiltering()
        ? `${counts.visible} / ${counts.total} 间`
        : `${counts.total} 间`;
    }
  }

  function stateBlock(text, tone = '', actionLabel = '', action = '') {
    const block = doc.createElement('div');
    block.className = tone ? `ec-state ec-state--${tone}` : 'ec-state';
    const label = doc.createElement('div');
    label.textContent = text;
    block.appendChild(label);

    if (actionLabel && action) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'ec-btn ec-btn--ghost';
      button.dataset.action = action;
      button.textContent = actionLabel;
      block.appendChild(button);
    }
    return block;
  }

  function renderSkeleton() {
    const wrap = doc.createElement('div');
    wrap.className = 'ec-skeleton';
    wrap.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < 6; index += 1) {
      const item = doc.createElement('div');
      item.className = 'ec-skeleton__item';
      wrap.appendChild(item);
    }
    resultsBody.replaceChildren(wrap);
  }

  function renderRoom(room) {
    const item = doc.createElement('li');
    item.className = 'ec-room';

    const top = doc.createElement('div');
    top.className = 'ec-room__top';

    const name = doc.createElement('div');
    name.className = 'ec-room__name';
    name.textContent = room.classroomName;
    top.appendChild(name);

    const tag = doc.createElement('span');
    tag.className = room.borrowable ? 'ec-tag ec-tag--borrowable' : 'ec-tag ec-tag--free';
    tag.textContent = room.borrowable ? '可借用' : '无排课';
    top.appendChild(tag);

    const meta = doc.createElement('div');
    meta.className = 'ec-room__meta';
    if (room.classroomCode && room.classroomCode !== room.classroomName) {
      const code = doc.createElement('span');
      code.textContent = `编号 ${room.classroomCode}`;
      meta.appendChild(code);
    }
    const seats = doc.createElement('span');
    seats.textContent = room.seats === null ? '座位数未知' : `${room.seats} 座`;
    meta.appendChild(seats);

    item.appendChild(top);
    item.appendChild(meta);
    return item;
  }

  function renderGroups(groups) {
    const fragment = doc.createDocumentFragment();
    for (const group of groups) {
      const section = doc.createElement('section');
      section.className = 'ec-group';

      const title = doc.createElement('div');
      title.className = 'ec-group__title';
      const heading = doc.createElement('h4');
      heading.textContent = group.name;
      const groupCount = doc.createElement('span');
      groupCount.textContent = `${group.rooms.length} 间`;
      title.appendChild(heading);
      title.appendChild(groupCount);

      const list = doc.createElement('ul');
      list.className = 'ec-room-list';
      for (const room of group.rooms) list.appendChild(renderRoom(room));

      section.appendChild(title);
      section.appendChild(list);
      fragment.appendChild(section);
    }
    resultsBody.replaceChildren(fragment);
  }

  function renderResultsBody(state) {
    if (state.optionsStatus === 'error') {
      resultsBody.replaceChildren(
        stateBlock(`选项接口失败，无法查询。${state.optionsError}`),
      );
      return;
    }

    if (state.optionsStatus !== 'ready') {
      resultsBody.replaceChildren(stateBlock('正在加载查询选项…'));
      return;
    }

    if (state.queryStatus === 'loading') {
      renderSkeleton();
      return;
    }

    if (state.queryStatus === 'error') {
      resultsBody.replaceChildren(
        stateBlock(`无法获取空教室：${state.queryError}`, 'error', '重试查询', 'retry-query'),
      );
      return;
    }

    if (state.queryStatus === 'success') {
      if (state.returnedCount === 0) {
        resultsBody.replaceChildren(stateBlock('该条件下暂无空教室。'));
        return;
      }
      const groups = controller.getGroups();
      if (groups.length === 0) {
        resultsBody.replaceChildren(
          stateBlock('没有符合筛选条件的教室。', '', '清除筛选', 'reset-filters'),
        );
        return;
      }
      renderGroups(groups);
      return;
    }

    resultsBody.replaceChildren(stateBlock('尚未查询，请选择条件后点击“查询空教室”。'));
  }

  function render(state) {
    term.textContent =
      state.optionsStatus === 'ready' && state.options
        ? state.options.termName
        : state.optionsStatus === 'error'
          ? '选项接口失败'
          : '正在读取学期信息…';

    const showAlert = state.optionsStatus === 'error';
    optionsAlert.hidden = !showAlert;
    if (showAlert) optionsErrorText.textContent = `选项接口失败：${state.optionsError}`;

    renderSelects(state);
    renderSections(state);
    renderStatus(state);
    renderActions(state);
    renderFilters(state);
    renderHead(state);
    renderResultsBody(state);
  }

  const events = new AbortController();
  const { signal } = events;

  function handleClick(event) {
    const target = event.target;
    if (!target || typeof target.closest !== 'function') return;

    const actionElement = target.closest('[data-action]');
    if (actionElement) {
      const action = actionElement.dataset.action;
      if (action === 'retry-options') controller.loadOptions();
      if (action === 'reset-filters') controller.resetFilters();
      if (action === 'retry-query') controller.query();
      return;
    }

    const presetElement = target.closest('[data-preset]');
    if (presetElement) {
      controller.setSections(presetElement.dataset.preset.split(',').map(Number));
      return;
    }

    const sectionElement = target.closest('[data-section]');
    if (sectionElement) {
      controller.toggleSection(Number(sectionElement.dataset.section));
    }
  }

  function handleChange(event) {
    const target = event.target;
    if (!target || typeof target.closest !== 'function') return;
    const field = target.closest('[data-field]');
    if (!field) return;
    controller.updateSelection({ [field.dataset.field]: field.value });
  }

  function handleFilterInput(event) {
    const target = event.target;
    if (!target || typeof target.closest !== 'function') return;

    const borrowable = target.closest('[data-filter="borrowableOnly"]');
    if (borrowable) {
      controller.setFilters({ borrowableOnly: borrowable.checked });
      return;
    }

    const keyword = target.closest('[data-filter="keyword"]');
    if (keyword) {
      controller.setFilters({ keyword: keyword.value });
      return;
    }

    const minSeats = target.closest('[data-filter="minSeats"]');
    if (minSeats) {
      controller.setFilters({ minSeats: minSeats.value });
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    controller.query();
  }

  root.addEventListener('click', handleClick, { signal });
  root.addEventListener('change', handleChange, { signal });
  form.addEventListener('submit', handleSubmit, { signal });
  filters.addEventListener('input', handleFilterInput, { signal });
  filters.addEventListener('change', handleFilterInput, { signal });

  const unsubscribe = controller.subscribe(render);
  controller.loadOptions();

  let unmounted = false;
  return function unmount() {
    if (unmounted) return;
    unmounted = true;
    events.abort();
    unsubscribe();
    controller.destroy();
    root.classList.remove('empty-classroom');
    root.removeAttribute('data-module');
    root.replaceChildren();
  };
}

export default { manifest, mount };
