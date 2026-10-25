import {
  DEFAULT_ENDPOINT,
  TermCoursesError,
  filterCourses,
  normalizeTermCode,
  requestTermCourses,
  validateTermCode,
} from "./api.js";
import { TERM_COURSE_LIST_STYLES } from "./styles.js";

const TEMPLATE = `
  <div class="tcl">
    <header class="tcl__header">
      <div>
        <h2 class="tcl__title">学期课程列表</h2>
        <p class="tcl__subtitle">课程数据来自学校教务接口；本模块不展示成绩、学分、绩点或 GPA。</p>
      </div>
      <span class="tcl__term-badge" data-term-badge hidden></span>
    </header>

    <form class="tcl__form" data-form novalidate>
      <label class="tcl__field">
        <span class="tcl__label">学期代码</span>
        <input
          class="tcl__input"
          data-term-input
          name="termCode"
          type="text"
          placeholder="请输入学期代码，如 2023-2024-1"
          autocomplete="off"
          spellcheck="false"
        />
      </label>
      <div class="tcl__actions">
        <button class="tcl__button tcl__button--primary" type="submit" data-submit>查询课程</button>
        <button class="tcl__button" type="button" data-refresh disabled>刷新</button>
      </div>
    </form>

    <div class="tcl__toolbar">
      <label class="tcl__field tcl__field--search">
        <span class="tcl__label">筛选</span>
        <input
          class="tcl__input"
          data-filter
          type="search"
          placeholder="按课程名或教师筛选已加载课程"
          autocomplete="off"
          disabled
        />
      </label>
    </div>

    <div class="tcl__status tcl__status--info" data-status role="status" aria-live="polite">
      <span data-status-text>请输入学期代码后查询课程</span>
      <button class="tcl__button tcl__button--small" type="button" data-retry hidden>重试</button>
    </div>

    <p class="tcl__meta" data-meta hidden></p>
    <div class="tcl__grid" data-grid></div>
    <p class="tcl__hint" data-hint hidden></p>
  </div>
`;

function createCard(document, course) {
  const card = document.createElement("article");
  card.className = "tcl__card";

  const head = document.createElement("header");
  head.className = "tcl__card-head";
  const title = document.createElement("h3");
  title.className = "tcl__card-title";
  title.textContent = course.name;
  head.append(title);

  const details = document.createElement("dl");
  details.className = "tcl__details";

  const rows = [
    ["课程编号", course.code, ""],
    ["教师", course.teacher, ""],
    ["课程安排", course.schedule, "tcl__row--schedule"],
    ["学期", course.termCode || "暂无", ""],
  ];

  for (const [label, value, extraClass] of rows) {
    const row = document.createElement("div");
    row.className = `tcl__row${extraClass ? ` ${extraClass}` : ""}`;
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    row.append(term, description);
    details.append(row);
  }

  card.append(head, details);
  return card;
}

/**
 * 挂载学期课程列表模块。
 *
 * 合并约定：
 * - mount(rootElement, context) 返回 unmount()；同时返回函数上带 `.unmount` 属性，
 *   便于路由按 `const unmount = mount(...)` 或 `const { unmount } = mount(...)` 使用。
 * - context.config.termCoursesEndpoint 可覆盖同源代理地址，默认 `/api/term-courses`。
 * - context.config.termCode 提供初始学期代码；未提供时页面保持输入状态，不设置默认学期。
 * - token 由服务端代理注入，模块和浏览器不接触 JWT。
 */
export function mount(rootElement, context = {}) {
  if (!rootElement || typeof rootElement.appendChild !== "function") {
    throw new TypeError("term-course-list: 需要挂载到一个 DOM 元素上");
  }

  const document = rootElement.ownerDocument;
  const config = context.config && typeof context.config === "object" ? context.config : {};
  const endpoint = config.termCoursesEndpoint || context.termCoursesEndpoint || DEFAULT_ENDPOINT;
  const initialTerm = normalizeTermCode(config.termCode ?? context.termCode ?? "");

  rootElement.classList.add("term-course-list");
  rootElement.replaceChildren();

  const styleElement = document.createElement("style");
  styleElement.setAttribute("data-term-course-list-style", "");
  styleElement.textContent = TERM_COURSE_LIST_STYLES;
  rootElement.append(styleElement);

  const wrapper = document.createElement("div");
  wrapper.innerHTML = TEMPLATE;
  const view = wrapper.firstElementChild;
  rootElement.append(view);

  const form = view.querySelector("[data-form]");
  const termInput = view.querySelector("[data-term-input]");
  const submitButton = view.querySelector("[data-submit]");
  const refreshButton = view.querySelector("[data-refresh]");
  const filterInput = view.querySelector("[data-filter]");
  const statusElement = view.querySelector("[data-status]");
  const statusText = view.querySelector("[data-status-text]");
  const retryButton = view.querySelector("[data-retry]");
  const metaElement = view.querySelector("[data-meta]");
  const gridElement = view.querySelector("[data-grid]");
  const hintElement = view.querySelector("[data-hint]");
  const termBadge = view.querySelector("[data-term-badge]");

  let allCourses = [];
  let currentTerm = initialTerm;
  let keyword = "";
  let requestController = null;
  let requestSequence = 0;
  let destroyed = false;

  function updateTermBadge() {
    termBadge.hidden = !currentTerm;
    termBadge.textContent = currentTerm ? `学期 ${currentTerm}` : "";
  }

  function setStatus(kind, message, { retryable = false } = {}) {
    statusElement.className = `tcl__status tcl__status--${kind}`;
    statusText.textContent = message;
    retryButton.hidden = !retryable;
  }

  function setBusy(busy) {
    submitButton.disabled = busy;
    refreshButton.disabled = busy || !currentTerm;
    filterInput.disabled = busy || allCourses.length === 0;
    if (busy) {
      view.setAttribute("aria-busy", "true");
    } else {
      view.removeAttribute("aria-busy");
    }
  }

  function renderGrid() {
    const visible = filterCourses(allCourses, keyword);
    const filtering = keyword.trim().length > 0;
    gridElement.replaceChildren();

    for (const course of visible) {
      gridElement.append(createCard(document, course));
    }

    if (filtering && allCourses.length > 0 && visible.length === 0) {
      hintElement.textContent = "没有匹配的课程，请调整筛选关键词。";
      hintElement.hidden = false;
    } else {
      hintElement.textContent = "";
      hintElement.hidden = true;
    }

    if (allCourses.length === 0) {
      metaElement.textContent = "";
      metaElement.hidden = true;
      return;
    }

    metaElement.hidden = false;
    metaElement.textContent = filtering
      ? `筛选出 ${visible.length} / ${allCourses.length} 门课程 · 学期 ${currentTerm || "暂无"}`
      : `共 ${allCourses.length} 门课程 · 学期 ${currentTerm || "暂无"}`;
  }

  async function loadCourses(rawTermCode) {
    const validation = validateTermCode(rawTermCode);
    if (!validation.ok) {
      setStatus("error", validation.message);
      termInput.focus();
      return;
    }

    const termCode = validation.termCode;
    const sameTerm = currentTerm === termCode;
    termInput.value = termCode;
    currentTerm = termCode;
    updateTermBadge();

    if (!sameTerm) {
      allCourses = [];
      keyword = "";
      filterInput.value = "";
    }

    if (requestController) requestController.abort();
    requestController = new AbortController();
    const requestId = ++requestSequence;

    setStatus("loading", "正在加载课程…");
    setBusy(true);
    renderGrid();

    try {
      const result = await requestTermCourses({
        termCode,
        endpoint,
        signal: requestController.signal,
      });
      if (destroyed || requestId !== requestSequence) return;

      currentTerm = result.termCode;
      allCourses = result.courses;
      updateTermBadge();
      renderGrid();
      setBusy(false);

      if (allCourses.length === 0) {
        setStatus("info", "当前学期没有可显示的课程");
      } else {
        setStatus("success", `已加载 ${allCourses.length} 门课程`);
      }
    } catch (error) {
      if (destroyed || requestId !== requestSequence) return;
      if (error instanceof TermCoursesError && error.code === "ABORTED") return;

      allCourses = [];
      keyword = "";
      filterInput.value = "";
      renderGrid();
      setBusy(false);

      const isKnown = error instanceof TermCoursesError;
      setStatus(
        "error",
        isKnown ? error.message : "课程加载失败，请稍后重试",
        { retryable: isKnown ? error.retryable : true }
      );
    } finally {
      if (requestId === requestSequence) {
        requestController = null;
      }
    }
  }

  const onSubmit = (event) => {
    event.preventDefault();
    loadCourses(termInput.value);
  };

  const onRefresh = () => {
    const termCode = currentTerm || termInput.value;
    if (!termCode.trim()) {
      setStatus("error", "请输入学期代码后查询课程");
      termInput.focus();
      return;
    }
    loadCourses(termCode);
  };

  const onFilter = () => {
    keyword = filterInput.value;
    renderGrid();
  };

  const onRetry = () => {
    loadCourses(currentTerm || termInput.value);
  };

  form.addEventListener("submit", onSubmit);
  refreshButton.addEventListener("click", onRefresh);
  filterInput.addEventListener("input", onFilter);
  retryButton.addEventListener("click", onRetry);

  if (initialTerm) {
    termInput.value = initialTerm;
    updateTermBadge();
  }
  renderGrid();
  setBusy(false);

  if (initialTerm) {
    loadCourses(initialTerm);
  }

  function unmount() {
    if (destroyed) return;
    destroyed = true;
    requestSequence += 1;
    if (requestController) {
      requestController.abort();
      requestController = null;
    }
    form.removeEventListener("submit", onSubmit);
    refreshButton.removeEventListener("click", onRefresh);
    filterInput.removeEventListener("input", onFilter);
    retryButton.removeEventListener("click", onRetry);
    rootElement.classList.remove("term-course-list");
    rootElement.replaceChildren();
  }

  unmount.unmount = unmount;
  return unmount;
}
