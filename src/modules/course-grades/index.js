import {
  CourseGradesError,
  INFO_ENDPOINT,
  SEARCH_ENDPOINT,
  displayValue,
  normalizeText,
  requestCourseGrade,
  requestCourseSearch,
  validateQuery,
} from "./api.js";
import {
  canGoNext,
  computeSegments,
  countText,
  hasGradeData,
  isScoreAvailable,
  scoreText,
} from "./logic.js";
import { COURSE_GRADES_STYLES } from "./styles.js";

const TEMPLATE = `
  <div class="cg">
    <header class="cg__header">
      <div>
        <h2 class="cg__title">课程给分情况</h2>
        <p class="cg__subtitle">按课程名或教师查询历史给分统计（平均分、最高分与分数段分布），仅作选课参考。</p>
      </div>
      <span class="cg__badge">校园课程服务</span>
    </header>

    <form class="cg__form" data-form novalidate>
      <label class="cg__field">
        <span class="cg__label">课程名</span>
        <input
          class="cg__input"
          data-course-input
          name="courseName"
          type="text"
          placeholder="例如：数学（1）"
          autocomplete="off"
          spellcheck="false"
        />
      </label>
      <label class="cg__field">
        <span class="cg__label">教师（可选）</span>
        <input
          class="cg__input"
          data-teacher-input
          name="teacher"
          type="text"
          placeholder="例如：杨海燕"
          autocomplete="off"
          spellcheck="false"
        />
      </label>
      <div class="cg__actions">
        <button class="cg__button cg__button--primary" type="submit" data-submit>查询课程</button>
      </div>
    </form>

    <div class="cg__status cg__status--info" data-status role="status" aria-live="polite">
      <span data-status-text>输入课程名或教师后查询课程</span>
      <button class="cg__button cg__button--small" type="button" data-retry hidden>重试</button>
    </div>

    <p class="cg__meta" data-meta hidden></p>
    <div class="cg__list" data-list></div>
    <p class="cg__hint" data-hint hidden></p>

    <nav class="cg__pagination" data-pagination hidden aria-label="课程分页">
      <button class="cg__button cg__button--small" type="button" data-prev disabled>上一页</button>
      <span class="cg__page-info" data-page-info></span>
      <button class="cg__button cg__button--small" type="button" data-next disabled>下一页</button>
    </nav>

    <section class="cg__grade" data-grade hidden aria-live="polite">
      <header class="cg__grade-head">
        <h3 class="cg__grade-title" data-grade-title></h3>
        <p class="cg__grade-teacher" data-grade-teacher></p>
      </header>
      <div class="cg__grade-body" data-grade-body></div>
    </section>
  </div>
`;

function createStat(document, label, value) {
  const stat = document.createElement("div");
  stat.className = "cg__stat";

  const labelElement = document.createElement("p");
  labelElement.className = "cg__stat-label";
  labelElement.textContent = label;

  const valueElement = document.createElement("p");
  valueElement.className = "cg__stat-value";
  valueElement.textContent = value;

  stat.append(labelElement, valueElement);
  return stat;
}

function createSegmentRow(document, segment) {
  const row = document.createElement("div");
  row.className = "cg__segment";

  const label = document.createElement("span");
  label.className = "cg__segment-label";
  label.textContent = segment.label;

  const track = document.createElement("span");
  track.className = "cg__bar";
  const fill = document.createElement("span");
  fill.className = `cg__bar-fill${segment.key === "d60" && segment.count > 0 ? " cg__bar-fill--low" : ""}`;
  fill.style.width = `${Math.min(100, Math.max(0, segment.percent))}%`;
  track.append(fill);

  const value = document.createElement("span");
  value.className = "cg__segment-value";
  value.textContent = `${segment.count} 人 · ${segment.percent}%`;

  row.append(label, track, value);
  return row;
}

/**
 * 挂载课程给分情况模块。
 *
 * 合并约定：
 * - mount(rootElement, context) 返回 unmount()，并带 `.unmount` 属性。
 * - context.config.searchEndpoint / gradeEndpoint 可覆盖同源代理地址。
 * - token 由主站服务端代理注入，模块和浏览器不接触 JWT。
 */
export function mount(rootElement, context = {}) {
  if (!rootElement || typeof rootElement.appendChild !== "function") {
    throw new TypeError("course-grades: 需要挂载到一个 DOM 元素上");
  }

  const document = rootElement.ownerDocument;
  const config = context.config && typeof context.config === "object" ? context.config : {};
  const searchEndpoint = config.searchEndpoint || context.searchEndpoint || SEARCH_ENDPOINT;
  const gradeEndpoint = config.gradeEndpoint || context.gradeEndpoint || INFO_ENDPOINT;

  rootElement.classList.add("course-grades");
  rootElement.replaceChildren();

  const styleElement = document.createElement("style");
  styleElement.setAttribute("data-course-grades-style", "");
  styleElement.textContent = COURSE_GRADES_STYLES;
  rootElement.append(styleElement);

  const wrapper = document.createElement("div");
  wrapper.innerHTML = TEMPLATE;
  const view = wrapper.firstElementChild;
  rootElement.append(view);

  const form = view.querySelector("[data-form]");
  const courseInput = view.querySelector("[data-course-input]");
  const teacherInput = view.querySelector("[data-teacher-input]");
  const submitButton = view.querySelector("[data-submit]");
  const statusElement = view.querySelector("[data-status]");
  const statusText = view.querySelector("[data-status-text]");
  const retryButton = view.querySelector("[data-retry]");
  const metaElement = view.querySelector("[data-meta]");
  const listElement = view.querySelector("[data-list]");
  const hintElement = view.querySelector("[data-hint]");
  const paginationElement = view.querySelector("[data-pagination]");
  const prevButton = view.querySelector("[data-prev]");
  const nextButton = view.querySelector("[data-next]");
  const pageInfoElement = view.querySelector("[data-page-info]");
  const gradeSection = view.querySelector("[data-grade]");
  const gradeTitle = view.querySelector("[data-grade-title]");
  const gradeTeacher = view.querySelector("[data-grade-teacher]");
  const gradeBody = view.querySelector("[data-grade-body]");

  let query = { courseName: "", teacher: "" };
  let page = 1;
  let courses = [];
  let selectedKey = "";
  let searchController = null;
  let searchSequence = 0;
  let gradeController = null;
  let gradeSequence = 0;
  let searching = false;
  let destroyed = false;

  function setStatus(kind, message, { retryable = false } = {}) {
    statusElement.className = `cg__status cg__status--${kind}`;
    statusText.textContent = message;
    retryButton.hidden = !retryable;
  }

  function setBusy(busy) {
    searching = busy;
    submitButton.disabled = busy;
    courseInput.disabled = busy;
    teacherInput.disabled = busy;
    prevButton.disabled = busy || page <= 1 || courses.length === 0;
    nextButton.disabled = busy || !canGoNext(courses);
    if (busy) {
      view.setAttribute("aria-busy", "true");
    } else {
      view.removeAttribute("aria-busy");
    }
  }

  function updatePagination() {
    paginationElement.hidden = courses.length === 0 && page <= 1;
    pageInfoElement.textContent = `第 ${page} 页`;
    prevButton.disabled = searching || page <= 1;
    nextButton.disabled = searching || !canGoNext(courses);
  }

  function renderList() {
    listElement.replaceChildren();
    for (const course of courses) {
      const item = document.createElement("article");
      item.className = `cg__item${course.key === selectedKey ? " cg__item--active" : ""}`;

      const main = document.createElement("div");
      main.className = "cg__item-main";

      const title = document.createElement("h3");
      title.className = "cg__item-title";
      title.textContent = displayValue(course.courseName);

      const teacher = document.createElement("p");
      teacher.className = "cg__item-teacher";
      teacher.textContent = `教师：${displayValue(course.courseTeacher)}`;

      main.append(title, teacher);

      const button = document.createElement("button");
      button.className = "cg__button cg__button--small";
      button.type = "button";
      button.dataset.viewKey = course.key;
      button.textContent = "查看给分";

      item.append(main, button);
      listElement.append(item);
    }

    metaElement.hidden = courses.length === 0;
    metaElement.textContent = courses.length
      ? `第 ${page} 页 · 显示 ${courses.length} 门课程`
      : "";

    if (!courses.length) {
      hintElement.textContent = searching ? "" : "没有匹配的课程，请调整课程名或教师后重试。";
      hintElement.hidden = searching;
    } else {
      hintElement.textContent = "";
      hintElement.hidden = true;
    }
    updatePagination();
  }

  function renderGradeMessage(message, { error = false } = {}) {
    gradeBody.replaceChildren();
    const paragraph = document.createElement("p");
    paragraph.className = `cg__status${error ? " cg__status--error" : ""}`;
    paragraph.textContent = message;
    gradeBody.append(paragraph);
  }

  function renderGrade(grade) {
    gradeBody.replaceChildren();
    const stats = document.createElement("div");
    stats.className = "cg__stats";
    stats.append(
      createStat(document, "平均分", scoreText(grade.avg)),
      createStat(document, "最高分", scoreText(grade.maxScore)),
      createStat(document, "样本人数", countText(grade.count))
    );

    const segments = document.createElement("div");
    segments.className = "cg__segments";
    for (const segment of computeSegments(grade)) {
      segments.append(createSegmentRow(document, segment));
    }

    gradeBody.append(stats, segments);

    const extras = [];
    if (isScoreAvailable(grade.usualAvg)) extras.push(`平时均分 ${scoreText(grade.usualAvg)}`);
    if (isScoreAvailable(grade.midtermAvg)) extras.push(`期中均分 ${scoreText(grade.midtermAvg)}`);
    if (isScoreAvailable(grade.finalAvg)) extras.push(`期末均分 ${scoreText(grade.finalAvg)}`);
    if (extras.length) {
      const extra = document.createElement("p");
      extra.className = "cg__extra";
      extra.textContent = extras.join(" · ");
      gradeBody.append(extra);
    }

    const note = document.createElement("p");
    note.className = "cg__note";
    note.textContent = "分数段占比按样本人数计算，0 人表示该分数段没有记录；数据为历史统计，仅供参考。";
    gradeBody.append(note);
  }

  function clearGradeSelection() {
    selectedKey = "";
    gradeSection.hidden = true;
    gradeBody.replaceChildren();
    gradeSequence += 1;
    if (gradeController) {
      gradeController.abort();
      gradeController = null;
    }
  }

  async function loadSearch({ resetPage = false } = {}) {
    const validation = validateQuery(query);
    if (!validation.ok) {
      setStatus("error", validation.message);
      courseInput.focus();
      return;
    }

    if (resetPage) {
      page = 1;
      clearGradeSelection();
    }

    query = { courseName: validation.courseName, teacher: validation.teacher };

    if (searchController) searchController.abort();
    searchController = new AbortController();
    const requestId = ++searchSequence;

    setStatus("loading", "正在查询课程…");
    courses = resetPage ? [] : courses;
    setBusy(true);
    renderList();

    try {
      const result = await requestCourseSearch({
        courseName: query.courseName,
        teacher: query.teacher,
        page,
        endpoint: searchEndpoint,
        signal: searchController.signal,
      });
      if (destroyed || requestId !== searchSequence) return;

      page = result.page;
      courses = result.courses;
      searching = false;
      setBusy(false);
      renderList();

      if (!courses.length) {
        setStatus("info", "本页没有匹配的课程，可调整关键词或返回上一页");
      } else {
        setStatus("success", `已找到 ${courses.length} 门课程（第 ${page} 页）`);
      }
    } catch (error) {
      if (destroyed || requestId !== searchSequence) return;
      if (error instanceof CourseGradesError && error.code === "ABORTED") return;

      courses = [];
      searching = false;
      setBusy(false);
      renderList();

      const known = error instanceof CourseGradesError;
      setStatus("error", known ? error.message : "课程查询失败，请稍后重试", {
        retryable: known ? error.retryable : true,
      });
    } finally {
      if (requestId === searchSequence) {
        searchController = null;
      }
    }
  }

  async function loadGrade(course) {
    selectedKey = course.key;
    renderList();

    gradeSection.hidden = false;
    gradeTitle.textContent = displayValue(course.courseName);
    gradeTeacher.textContent = `教师：${displayValue(course.courseTeacher)}`;
    gradeBody.replaceChildren();

    if (gradeController) gradeController.abort();
    gradeController = new AbortController();
    const requestId = ++gradeSequence;

    renderGradeMessage("正在加载给分数据…");

    try {
      const grade = await requestCourseGrade({
        courseName: course.courseName,
        teacher: course.courseTeacher,
        endpoint: gradeEndpoint,
        signal: gradeController.signal,
      });
      if (destroyed || requestId !== gradeSequence) return;

      if (!hasGradeData(grade)) {
        renderGradeMessage("暂无该课程的给分记录（样本人数为 0）。");
        return;
      }
      renderGrade(grade);
    } catch (error) {
      if (destroyed || requestId !== gradeSequence) return;
      if (error instanceof CourseGradesError && error.code === "ABORTED") return;

      const known = error instanceof CourseGradesError;
      renderGradeMessage(
        known ? error.message : "给分数据加载失败，请稍后重试",
        { error: true }
      );
    } finally {
      if (requestId === gradeSequence) {
        gradeController = null;
      }
    }
  }

  const onSubmit = (event) => {
    event.preventDefault();
    query = {
      courseName: courseInput.value,
      teacher: teacherInput.value,
    };
    loadSearch({ resetPage: true });
  };

  const onListClick = (event) => {
    const button = event.target.closest("[data-view-key]");
    if (!button) return;
    const course = courses.find((item) => item.key === button.dataset.viewKey);
    if (course) loadGrade(course);
  };

  const onPrev = () => {
    if (page <= 1) return;
    page -= 1;
    clearGradeSelection();
    loadSearch();
  };

  const onNext = () => {
    if (!canGoNext(courses)) return;
    page += 1;
    clearGradeSelection();
    loadSearch();
  };

  const onRetry = () => {
    loadSearch();
  };

  form.addEventListener("submit", onSubmit);
  listElement.addEventListener("click", onListClick);
  prevButton.addEventListener("click", onPrev);
  nextButton.addEventListener("click", onNext);
  retryButton.addEventListener("click", onRetry);

  renderList();
  setBusy(false);

  if (config.courseName || context.courseName) {
    courseInput.value = normalizeText(config.courseName ?? context.courseName);
  }
  if (config.teacher || context.teacher) {
    teacherInput.value = normalizeText(config.teacher ?? context.teacher);
  }

  function unmount() {
    if (destroyed) return;
    destroyed = true;
    searchSequence += 1;
    gradeSequence += 1;
    if (searchController) {
      searchController.abort();
      searchController = null;
    }
    if (gradeController) {
      gradeController.abort();
      gradeController = null;
    }
    form.removeEventListener("submit", onSubmit);
    listElement.removeEventListener("click", onListClick);
    prevButton.removeEventListener("click", onPrev);
    nextButton.removeEventListener("click", onNext);
    retryButton.removeEventListener("click", onRetry);
    rootElement.classList.remove("course-grades");
    rootElement.replaceChildren();
  }

  unmount.unmount = unmount;
  return unmount;
}
