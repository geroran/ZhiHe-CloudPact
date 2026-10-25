/**
 * Teacher/course query module.
 *
 * Contract: mount(rootElement, context) -> unmount()
 * context: { notify?: (message) => void, config?: { coursesEndpoint?: string } }
 *
 * The module only calls /api/courses. It never sees, stores, or forwards the
 * ehall session cookie, and it has no mock/offline data path.
 */
import "./teacher-course-search.css";
import { requestCoursePage } from "./api.js";
import {
  DEFAULT_PAGE_SIZE,
  QUERY_MODES,
  applyFilters,
  buildRowEntries,
  collectFilterOptions,
  defaultSemester,
  formatScheduleTime,
  isBlank,
  normalizePagePayload,
  parseScheduleText,
  textOr,
  totalPages,
} from "./course-utils.js";

const FILTER_DEFS = [
  { key: "type", label: "教学类型", field: "BQDM_DISPLAY" },
  { key: "category", label: "通识类别", field: "XGXKLBDM_DISPLAY" },
  { key: "campus", label: "校区", field: "XXXQDM_DISPLAY" },
];

const DETAIL_FIELDS = [
  ["课程号", "KCH"],
  ["课序号", "KXH"],
  ["学期", "XNXQDM"],
  ["授课班级", "SKBJ"],
  ["开课院系", "KKDWDM_DISPLAY"],
  ["排课单位", "PKDWDM_DISPLAY"],
  ["是否通识选修", "SFXGXK_DISPLAY"],
  ["学分", "XF"],
  ["课程学时", "XS"],
  ["授课学时", "SKXS"],
  ["参考学时", "KNZXS"],
  ["选课人数（参考）", "NSXKRS"],
  ["容量（参考）", "KRL"],
];

const ERROR_COPY = {
  EHALL_NOT_CONFIGURED: {
    title: "教务会话未配置",
    message: "服务端尚未配置教务会话，无法获取实时课程数据。请在服务端环境变量中配置后重试。",
    hint: "页面不会要求输入教务密码。",
  },
  EHALL_SESSION_EXPIRED: {
    title: "教务会话已失效",
    message: "教务系统未接受当前会话，请在服务端更新演示会话后重试。",
    hint: "页面不会要求输入教务密码。",
  },
  EHALL_TIMEOUT: {
    title: "教务系统响应超时",
    message: "上游未在限定时间内返回结果，请稍后重试。",
    hint: "已保留本次查询条件。",
  },
  EHALL_UNAVAILABLE: {
    title: "教务系统暂时无法访问",
    message: "本地代理无法连接教务系统，请检查网络或服务端代理配置后重试。",
    hint: "已保留本次查询条件。",
  },
  EHALL_BAD_RESPONSE: {
    title: "教务系统返回异常",
    message: "上游返回的内容无法识别为课程数据，请稍后重试。",
    hint: "未展示任何推测数据。",
  },
  EHALL_UPSTREAM_ERROR: {
    title: "教务系统返回错误",
    message: "上游返回了错误状态，请稍后重试。",
    hint: "已保留本次查询条件。",
  },
  NETWORK_ERROR: {
    title: "无法连接本地课程查询服务",
    message: "请确认服务端已启动（npm run api），然后重试。",
    hint: "已保留本次查询条件。",
  },
  BAD_RESPONSE: {
    title: "返回数据异常",
    message: "服务返回的数据结构不符合预期，请稍后重试。",
    hint: "未展示任何推测数据。",
  },
  DEFAULT: {
    title: "查询失败",
    message: "查询过程中出现未预期的错误，请稍后重试。",
    hint: "已保留本次查询条件。",
  },
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function errorInfo(error) {
  return ERROR_COPY[error?.code] || ERROR_COPY.DEFAULT;
}

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path below.
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

function metaItem(label, value) {
  const item = el("div", "tcx-meta");
  item.append(el("dt", "tcx-meta__label", label), el("dd", "tcx-meta__value", value));
  return item;
}

function labelTag(kind, value, fallback) {
  const hasValue = !isBlank(value);
  const tag = el("span", `tcx-tag tcx-tag--${kind}${hasValue ? "" : " is-empty"}`);
  tag.append(el("span", "tcx-tag__label", kind === "type" ? "教学类型" : "通识类别"));
  tag.append(document.createTextNode(hasValue ? String(value).trim() : fallback));
  return tag;
}

export const manifest = Object.freeze({
  id: "teacher-course-search",
  title: "教师课程查询",
  description: "按教师姓名或课程名查询课程安排、教学类型与通识选修类别",
});

export function mount(root, context = {}) {
  if (!root) throw new Error("teacher-course-search: 缺少挂载节点");

  const notify = typeof context.notify === "function" ? context.notify : () => {};
  const config =
    context.config && typeof context.config === "object" ? context.config : {};
  const endpoint = config.coursesEndpoint || context.coursesEndpoint || "/api/courses";
  const semesterOverride =
    typeof import.meta.env?.VITE_DEFAULT_SEMESTER === "string"
      ? import.meta.env.VITE_DEFAULT_SEMESTER
      : "";

  root.innerHTML = `
    <section class="tcx" aria-labelledby="tcx-title">
      <header class="tcx-hero">
        <div class="tcx-hero__text">
          <p class="tcx-kicker">云南大学 · 教务数据</p>
          <h1 id="tcx-title">教师课程查询</h1>
          <p class="tcx-hero__subtitle">按教师姓名或课程名查询课程安排、课程教学类型与通识选修类别。</p>
        </div>
        <span class="tcx-badge">
          <span class="tcx-badge__dot" aria-hidden="true"></span>
          实时接口
        </span>
      </header>

      <form class="tcx-form" novalidate>
        <div class="tcx-field tcx-field--mode">
          <span class="tcx-field__label">查询对象</span>
          <div class="tcx-segmented" role="radiogroup" aria-label="查询对象">
            <label class="tcx-segmented__item">
              <input type="radio" name="tc-mode" value="teacher" checked />
              <span>按教师</span>
            </label>
            <label class="tcx-segmented__item">
              <input type="radio" name="tc-mode" value="course" />
              <span>按课程</span>
            </label>
          </div>
        </div>

        <div class="tcx-field tcx-field--grow">
          <label class="tcx-field__label" for="tc-keyword" data-role="keyword-label">教师姓名</label>
          <input
            id="tc-keyword"
            name="keyword"
            type="search"
            autocomplete="off"
            maxlength="60"
            placeholder="例如：杨海燕"
            data-role="keyword"
          />
        </div>

        <div class="tcx-field tcx-field--semester">
          <label class="tcx-field__label" for="tc-semester">学期</label>
          <input
            id="tc-semester"
            name="semester"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            maxlength="11"
            data-role="semester"
          />
        </div>

        <div class="tcx-actions">
          <button type="submit" class="tcx-btn tcx-btn--primary" data-role="submit">查询</button>
          <button type="button" class="tcx-btn tcx-btn--ghost" data-role="reset">清空</button>
        </div>
      </form>

      <p class="tcx-form-error" data-role="form-error" role="alert" hidden></p>

      <div class="tcx-toolbar" data-role="toolbar" hidden>
        <div class="tcx-toolbar__head">
          <strong>当前页筛选</strong>
          <span>仅作用于已加载的本页结果</span>
        </div>
        <div class="tcx-toolbar__row" data-role="filter-row"></div>
      </div>

      <div class="tcx-summary" data-role="summary" hidden></div>
      <div class="tcx-view" data-role="view" role="status" aria-live="polite"></div>
      <div class="tcx-list" data-role="list"></div>
      <nav class="tcx-pager" data-role="pager" aria-label="课程结果分页" hidden></nav>

      <p class="tcx-foot">
        数据来源：云南大学教务系统实时接口 · 当前学期
        <span data-role="foot-semester">—</span>
      </p>
    </section>
  `;

  const section = root.querySelector(".tcx");
  const form = section.querySelector(".tcx-form");
  const keywordInput = section.querySelector('[data-role="keyword"]');
  const semesterInput = section.querySelector('[data-role="semester"]');
  const keywordLabel = section.querySelector('[data-role="keyword-label"]');
  const submitButton = section.querySelector('[data-role="submit"]');
  const resetButton = section.querySelector('[data-role="reset"]');
  const formError = section.querySelector('[data-role="form-error"]');
  const toolbar = section.querySelector('[data-role="toolbar"]');
  const filterRow = section.querySelector('[data-role="filter-row"]');
  const summary = section.querySelector('[data-role="summary"]');
  const view = section.querySelector('[data-role="view"]');
  const list = section.querySelector('[data-role="list"]');
  const pager = section.querySelector('[data-role="pager"]');
  const footSemester = section.querySelector('[data-role="foot-semester"]');
  const modeInputs = Array.from(section.querySelectorAll('input[name="tc-mode"]'));

  const state = {
    mode: "teacher",
    pageSize: DEFAULT_PAGE_SIZE,
    page: 1,
    loading: false,
    data: null,
    error: null,
    filters: { type: "", category: "", campus: "" },
    expanded: new Set(),
    lastQuery: null,
    seq: 0,
  };

  let controller = null;
  let destroyed = false;

  semesterInput.value = defaultSemester(new Date(), semesterOverride);
  footSemester.textContent = semesterInput.value;

  function setFormError(message) {
    formError.textContent = message;
    formError.hidden = !message;
  }

  function updateModeCopy() {
    const mode = QUERY_MODES[state.mode] || QUERY_MODES.teacher;
    keywordLabel.textContent = mode.label;
    keywordInput.placeholder = mode.placeholder;
  }

  function setBusy(isBusy) {
    state.loading = isBusy;
    submitButton.disabled = isBusy;
    submitButton.textContent = isBusy ? "查询中…" : "查询";
    section.setAttribute("aria-busy", String(isBusy));
  }

  function clearResults() {
    state.data = null;
    state.error = null;
    state.filters = { type: "", category: "", campus: "" };
    state.expanded.clear();
    state.lastQuery = null;
    toolbar.hidden = true;
    summary.hidden = true;
    pager.hidden = true;
    list.replaceChildren();
    renderInitial();
  }

  function cancelInFlight() {
    if (controller) {
      controller.abort();
      controller = null;
    }
    state.seq += 1;
    if (state.loading) setBusy(false);
  }

  function renderInitial() {
    view.replaceChildren();
    const box = el("div", "tcx-state");
    box.append(
      el("h2", "tcx-state__title", "输入教师姓名或课程名称开始查询"),
      el(
        "p",
        "tcx-state__text",
        "查询由服务端转发至教务系统，页面不会要求输入教务密码。可切换“按教师”或“按课程”改变检索字段。",
      ),
    );
    view.append(box);
    footSemester.textContent = semesterInput.value || defaultSemester(new Date(), semesterOverride);
  }

  function renderLoading() {
    view.replaceChildren();
    const box = el("div", "tcx-state tcx-state--loading");
    box.append(el("p", "tcx-state__text", "正在从教务系统查询课程…"));
    view.append(box);

    list.replaceChildren();
    for (let i = 0; i < 4; i += 1) {
      const skeleton = el("div", "tcx-skeleton", undefined);
      skeleton.append(
        el("span", "tcx-skeleton__line tcx-skeleton__line--title"),
        el("span", "tcx-skeleton__line"),
        el("span", "tcx-skeleton__line tcx-skeleton__line--short"),
        el("span", "tcx-skeleton__line"),
      );
      list.append(skeleton);
    }
    toolbar.hidden = true;
    summary.hidden = true;
    pager.hidden = true;
  }

  function buildScheduleBlock(raw) {
    const schedule = parseScheduleText(raw);
    const box = el("div", "tcx-schedule");
    box.append(el("span", "tcx-schedule__label", "上课时间"));
    if (schedule.empty) {
      box.append(el("p", "tcx-schedule__empty", "暂未提供排课信息"));
      return box;
    }
    const items = el("ul", "tcx-schedule__list");
    for (const item of schedule.items) {
      const line = el("li", `tcx-schedule__item${item.parsed ? "" : " tcx-schedule__item--raw"}`);
      line.append(el("span", "tcx-schedule__time", formatScheduleTime(item)));
      if (item.parsed && item.place) {
        line.append(el("span", "tcx-schedule__place", item.place));
      }
      items.append(line);
    }
    box.append(items);
    return box;
  }

  function buildDetails(row) {
    const wrap = el("div", "tcx-details");
    const grid = el("dl", "tcx-details__grid");
    let rendered = 0;
    for (const [label, field] of DETAIL_FIELDS) {
      if (isBlank(row?.[field])) continue;
      grid.append(metaItem(label, textOr(row[field])));
      rendered += 1;
    }
    if (rendered === 0) {
      wrap.append(el("p", "tcx-details__empty", "接口未返回更多详情字段。"));
    } else {
      wrap.append(grid);
    }

    if (!isBlank(row?.YPSJDD)) {
      const raw = el("div", "tcx-details__raw");
      const head = el("div", "tcx-details__raw-head");
      head.append(el("span", "tcx-details__raw-label", "原始排课文本"));
      const copy = el("button", "tcx-btn tcx-btn--ghost tcx-btn--small", "复制原文");
      copy.type = "button";
      copy.addEventListener("click", async () => {
        const ok = await copyText(String(row.YPSJDD));
        notify(ok ? "已复制排课原文" : "复制失败，请手动选择文本");
      });
      head.append(copy);
      raw.append(head, el("pre", "tcx-details__pre", String(row.YPSJDD)));
      wrap.append(raw);
    }

    return wrap;
  }

  function buildCard(entry, index) {
    const { row, key } = entry;
    const card = el("article", "tcx-card");
    card.dataset.key = key;

    const head = el("div", "tcx-card__head");
    head.append(el("h2", "tcx-card__title", textOr(row?.KCM, "未命名课程")));
    const tags = el("div", "tcx-card__tags");
    tags.append(
      labelTag("type", row?.BQDM_DISPLAY, "类型未提供"),
      labelTag("category", row?.XGXKLBDM_DISPLAY, "类别未提供"),
    );
    if (!isBlank(row?.KXH)) {
      tags.append(el("span", "tcx-chip", `课序号 ${String(row.KXH).trim()}`));
    }
    head.append(tags);
    card.append(head);

    const meta = el("dl", "tcx-card__meta");
    meta.append(
      metaItem("教师", textOr(row?.SKJS, "教师未提供")),
      metaItem("校区", textOr(row?.XXXQDM_DISPLAY, "校区未提供")),
      metaItem("院系", textOr(row?.KKDWDM_DISPLAY, "院系未提供")),
    );
    if (!isBlank(row?.SFXGXK_DISPLAY)) {
      meta.append(metaItem("是否通识选修", textOr(row.SFXGXK_DISPLAY)));
    }
    const stats = [];
    if (!isBlank(row?.XF)) stats.push(`学分 ${textOr(row.XF)}`);
    if (!isBlank(row?.NSXKRS) || !isBlank(row?.KRL)) {
      stats.push(`选课 ${textOr(row?.NSXKRS, "—")} / 容量 ${textOr(row?.KRL, "—")}`);
    }
    if (stats.length > 0) meta.append(metaItem("数量", stats.join(" · ")));
    card.append(meta);

    card.append(buildScheduleBlock(row?.YPSJDD));

    const detailsId = `tcx-details-${index}`;
    const isOpen = state.expanded.has(key);
    const toggle = el("button", "tcx-card__toggle");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", String(isOpen));
    toggle.setAttribute("aria-controls", detailsId);
    toggle.append(
      el("span", "tcx-card__toggle-text", isOpen ? "收起详情" : "展开详情"),
      el("span", "tcx-card__toggle-icon", "⌄"),
    );
    card.append(toggle);

    const details = el("div", "tcx-card__details");
    details.hidden = !isOpen;
    details.id = detailsId;
    details.append(buildDetails(row));
    card.append(details);

    toggle.addEventListener("click", () => {
      const open = !state.expanded.has(key);
      if (open) state.expanded.add(key);
      else state.expanded.delete(key);
      toggle.setAttribute("aria-expanded", String(open));
      toggle.querySelector(".tcx-card__toggle-text").textContent = open ? "收起详情" : "展开详情";
      details.hidden = !open;
      card.classList.toggle("is-open", open);
    });

    return card;
  }

  function renderFilters() {
    const rows = state.data?.rows || [];
    const previous = { ...state.filters };
    filterRow.replaceChildren();
    let anyOptions = false;

    for (const def of FILTER_DEFS) {
      const options = collectFilterOptions(rows, def.field);
      if (options.length === 0) {
        state.filters[def.key] = "";
        continue;
      }
      anyOptions = true;
      const field = el("div", "tcx-filter");
      const id = `tcx-filter-${def.key}`;
      const label = el("label", "tcx-filter__label", def.label);
      label.htmlFor = id;
      const select = el("select", "tcx-filter__select");
      select.id = id;
      select.dataset.filterKey = def.key;

      const all = el("option", undefined, `全部${def.label}`);
      all.value = "";
      select.append(all);
      for (const option of options) {
        const node = el("option", undefined, option);
        node.value = option;
        select.append(node);
      }
      if (options.includes(previous[def.key])) {
        select.value = previous[def.key];
      } else {
        state.filters[def.key] = "";
      }
      select.addEventListener("change", () => {
        state.filters[def.key] = select.value;
        renderSummary();
        renderList();
      });

      field.append(label, select);
      filterRow.append(field);
    }

    toolbar.hidden = !anyOptions;
  }

  function renderSummary() {
    if (!state.data) {
      summary.hidden = true;
      return;
    }
    const pageCount = totalPages(state.data.totalSize, state.data.pageSize);
    const entries = buildRowEntries(state.data.rows);
    const visible = entries.filter((entry) => applyFilters([entry.row], state.filters).length > 0);
    const filtersActive =
      !isBlank(state.filters.type) ||
      !isBlank(state.filters.category) ||
      !isBlank(state.filters.campus);

    const modeLabel = state.lastQuery?.mode === "course" ? "课程" : "教师";
    summary.replaceChildren();
    const line = el("div", "tcx-summary__line");
    line.append(
      el("strong", undefined, `共 ${state.data.totalSize} 条`),
      el("span", undefined, `第 ${state.data.pageNumber} / ${pageCount} 页`),
      el(
        "span",
        "tcx-summary__query",
        `按${modeLabel}「${state.lastQuery?.keyword || ""}」· 学期 ${state.lastQuery?.semester || semesterInput.value}`,
      ),
    );
    summary.append(line);
    if (filtersActive) {
      summary.append(
        el(
          "p",
          "tcx-summary__filtered",
          `当前页筛选后显示 ${visible.length} / ${entries.length} 条；总条数仍以教务接口为准。`,
        ),
      );
    }
    summary.hidden = false;
  }

  function renderList() {
    list.replaceChildren();
    if (!state.data) return;
    const entries = buildRowEntries(state.data.rows);
    const visible = entries.filter((entry) => applyFilters([entry.row], state.filters).length > 0);

    if (visible.length === 0) {
      const box = el("div", "tcx-state tcx-state--empty");
      box.append(
        el("h2", "tcx-state__title", state.data.rows.length > 0 ? "当前页没有符合筛选条件的课程" : "没有找到匹配课程"),
        el(
          "p",
          "tcx-state__text",
          state.data.rows.length > 0
            ? "可以调整或清空筛选条件；筛选只作用于当前页。"
            : "可调整关键词或学期后重新查询。查询条件已保留。",
        ),
      );
      list.append(box);
      return;
    }

    const fragment = document.createDocumentFragment();
    visible.forEach((entry, index) => fragment.append(buildCard(entry, index)));
    list.append(fragment);
  }

  function renderPager() {
    if (!state.data || state.data.totalSize <= 0) {
      pager.hidden = true;
      return;
    }
    const pageCount = totalPages(state.data.totalSize, state.data.pageSize);
    const pageNumber = state.data.pageNumber;
    pager.replaceChildren();

    const prev = el("button", "tcx-btn tcx-btn--ghost", "上一页");
    prev.type = "button";
    prev.disabled = pageNumber <= 1;
    prev.addEventListener("click", () => runQuery({ page: pageNumber - 1 }));

    const status = el("span", "tcx-pager__status", `第 ${pageNumber} / ${pageCount} 页`);

    const next = el("button", "tcx-btn tcx-btn--ghost", "下一页");
    next.type = "button";
    next.disabled = pageNumber >= pageCount;
    next.addEventListener("click", () => runQuery({ page: pageNumber + 1 }));

    pager.append(prev, status, next);
    pager.hidden = false;
  }

  function renderResults() {
    renderFilters();
    renderSummary();
    renderList();
    renderPager();
  }

  function renderError(error) {
    view.replaceChildren();
    list.replaceChildren();
    toolbar.hidden = true;
    summary.hidden = true;
    pager.hidden = true;

    const info = errorInfo(error);
    const box = el("div", "tcx-state tcx-state--error");
    box.setAttribute("role", "alert");
    box.append(el("h2", "tcx-state__title", info.title), el("p", "tcx-state__text", info.message));
    if (info.hint) box.append(el("p", "tcx-state__hint", info.hint));
    if (error?.code) {
      box.dataset.errorCode = error.code;
    }

    const retry = el("button", "tcx-btn tcx-btn--primary", "重试");
    retry.type = "button";
    retry.addEventListener("click", () => {
      if (state.lastQuery) runQuery({});
      else submitButton.focus();
    });
    box.append(retry);
    view.append(box);
    retry.focus({ preventScroll: true });
  }

  function renderSuccess() {
    if (!state.data) {
      renderInitial();
      return;
    }
    if (state.data.rows.length === 0) {
      view.replaceChildren();
      const box = el("div", "tcx-state tcx-state--empty");
      box.append(
        el("h2", "tcx-state__title", "没有找到匹配课程"),
        el(
          "p",
          "tcx-state__text",
          `按「${state.lastQuery?.keyword || ""}」在学期 ${state.lastQuery?.semester || semesterInput.value} 未查询到课程。可调整关键词或学期后重新查询。`,
        ),
      );
      view.append(box);
      list.replaceChildren();
      renderFilters();
      renderSummary();
      renderPager();
      return;
    }
    view.replaceChildren();
    const done = el("p", "tcx-sr-only", `查询完成，共 ${state.data.totalSize} 条结果。`);
    view.append(done);
    renderResults();
  }

  function focusKeyword() {
    keywordInput.focus({ preventScroll: false });
  }

  async function runQuery({ page } = {}) {
    const keyword = (state.lastQuery?.keyword || keywordInput.value || "").trim();
    if (!keyword) {
      cancelInFlight();
      setFormError("请输入教师姓名或课程名称。");
      focusKeyword();
      return;
    }
    const semester = (state.lastQuery?.semester || semesterInput.value || "").trim() ||
      defaultSemester(new Date(), semesterOverride);
    if (!/^\d{4}-\d{4}-[1-3]$/.test(semester)) {
      cancelInFlight();
      setFormError("学期格式应为 2025-2026-2，请检查后重试。");
      semesterInput.focus();
      return;
    }

    cancelInFlight();
    setFormError("");
    const mode = state.lastQuery?.mode || state.mode;
    const targetPage =
      Number.isInteger(page) && page >= 1 ? page : Number(state.lastQuery?.page) || 1;
    const params = {
      mode,
      keyword,
      semester,
      page: targetPage,
      pageSize: state.pageSize,
    };

    state.seq += 1;
    const seq = state.seq;
    controller = new AbortController();
    const signal = controller.signal;

    state.lastQuery = params;
    state.error = null;
    state.data = null;
    state.filters = { type: "", category: "", campus: "" };
    state.expanded.clear();
    footSemester.textContent = semester;
    setBusy(true);
    renderLoading();

    try {
      const raw = await requestCoursePage(params, { signal, endpoint });
      if (destroyed || seq !== state.seq) return;
      const data = normalizePagePayload(raw);
      state.data = data;
      state.page = data.pageNumber;
      state.error = null;
    } catch (error) {
      if (destroyed || seq !== state.seq || error?.name === "AbortError") return;
      state.data = null;
      state.error = error && error.code ? error : Object.assign(error || {}, { code: "DEFAULT" });
      if (import.meta.env?.DEV) {
        console.warn("[teacher-course-search]", state.error.code, error);
      }
    } finally {
      if (!destroyed && seq === state.seq) {
        setBusy(false);
        controller = null;
        if (state.error) renderError(state.error);
        else renderSuccess();
        if (state.data && state.data.pageNumber !== targetPage) {
          // Upstream page number is authoritative for display.
          state.page = state.data.pageNumber;
        }
      }
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    // A fresh submit resets the pager to page 1.
    state.lastQuery = null;
    runQuery({ page: 1 });
  });

  modeInputs.forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      cancelInFlight();
      state.mode = input.value;
      updateModeCopy();
      setFormError("");
      clearResults();
    });
  });

  resetButton.addEventListener("click", () => {
    cancelInFlight();
    keywordInput.value = "";
    state.filters = { type: "", category: "", campus: "" };
    state.expanded.clear();
    setFormError("");
    clearResults();
    focusKeyword();
  });

  keywordInput.addEventListener("input", () => {
    if (formError.hidden === false) setFormError("");
  });

  semesterInput.addEventListener("change", () => {
    footSemester.textContent = semesterInput.value || "—";
  });

  updateModeCopy();
  renderInitial();

  return function unmount() {
    destroyed = true;
    state.seq += 1;
    if (controller) {
      controller.abort();
      controller = null;
    }
    root.replaceChildren();
  };
}
