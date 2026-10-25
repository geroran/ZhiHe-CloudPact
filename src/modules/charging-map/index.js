import { LAYOUT, PORT_CELLS } from "./layout.js";
import {
  STATUS,
  STATUS_LABELS,
  buildStatusIndex,
  computeStats,
  listFreePorts,
} from "./logic.js";
import { fetchChargingData } from "./api.js";

const STYLE_ATTRIBUTE = "data-charging-map-styles";
const STYLE_URL = new URL("./styles.css", import.meta.url);
const DATE_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function formatTime(value) {
  if (!value) return "时间未知";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return DATE_FORMATTER.format(date);
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function ensureStyles() {
  if (document.querySelector(`link[${STYLE_ATTRIBUTE}]`)) return null;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = STYLE_URL.href;
  link.setAttribute(STYLE_ATTRIBUTE, "");
  document.head.append(link);
  return link;
}

function buildShell() {
  const section = createElement("section", "charging-map");
  section.innerHTML = `
    <header class="charging-map__header">
      <div class="charging-map__heading">
        <h2 class="charging-map__title" id="charging-map-title">桦苑电瓶车充电口导航</h2>
        <p class="charging-map__subtitle">仅展示桦苑充电站 · 端口状态经本项目服务端代理实时查询</p>
      </div>
      <div class="charging-map__actions">
        <button type="button" class="charging-map__button charging-map__button--primary" data-refresh>刷新状态</button>
        <button type="button" class="charging-map__button" data-list aria-haspopup="dialog" aria-expanded="false">空闲端口</button>
        <button type="button" class="charging-map__button" data-fullscreen aria-pressed="false">全屏</button>
      </div>
    </header>
    <p class="charging-map__status-line" data-status role="status" aria-live="polite">正在获取桦苑实时端口状态…</p>
    <div class="charging-map__notice" data-notice hidden></div>
    <div class="charging-map__summary" data-summary hidden></div>
    <div class="charging-map__legend" aria-label="端口状态图例">
      <span class="charging-map__legend-item"><span class="charging-map__legend-swatch is-free"></span>空闲</span>
      <span class="charging-map__legend-item"><span class="charging-map__legend-swatch is-busy"></span>占用</span>
      <span class="charging-map__legend-item"><span class="charging-map__legend-swatch is-unavailable"></span>故障/未识别</span>
      <span class="charging-map__legend-item"><span class="charging-map__legend-swatch is-none"></span>未知/查询中</span>
      <span class="charging-map__legend-item charging-map__legend-item--path"><span class="charging-map__legend-swatch is-path"></span>过道</span>
    </div>
    <div class="charging-map__scroll" data-scroll tabindex="0" role="region" aria-label="桦苑充电口平面布局，整页展示 51 行、15 列">
      <table class="charging-map__table">
        <caption class="charging-map__sr-only">桦苑充电口平面布局，共 51 行、15 列，包含 500 个端口格</caption>
        <tbody data-tbody></tbody>
      </table>
    </div>
    <div class="charging-map__overlay" data-overlay hidden>
      <div class="charging-map__overlay-panel" role="dialog" aria-modal="true" aria-labelledby="charging-map-list-title">
        <div class="charging-map__overlay-head">
          <h3 class="charging-map__overlay-title" id="charging-map-list-title">空闲端口</h3>
          <button type="button" class="charging-map__button" data-close-list>关闭</button>
        </div>
        <p class="charging-map__overlay-count" data-free-count></p>
        <div class="charging-map__overlay-list" data-free-list></div>
      </div>
    </div>
  `;

  const tbody = section.querySelector("[data-tbody]");
  const cellElements = new Map();

  for (const row of LAYOUT) {
    const tr = document.createElement("tr");
    for (const cell of row) {
      const td = document.createElement("td");
      if (cell.type === "port") {
        td.id = cell.id;
        td.className = STATUS.UNKNOWN;
        td.textContent = cell.label;
        td.dataset.deviceNo = String(cell.deviceNo);
        td.dataset.portNo = String(cell.portNo);
        td.dataset.status = STATUS.UNKNOWN;
        td.setAttribute("aria-label", `设备 ${cell.deviceNo} 端口 ${cell.portNo}，状态未知`);
        td.title = `设备 ${cell.deviceNo} 端口 ${cell.portNo}，状态未知`;
        cellElements.set(cell.id, td);
      } else {
        td.className = cell.accent ? "path path--accent" : "path";
        if (cell.label) td.textContent = cell.label;
      }
      tr.append(td);
    }
    tbody.append(tr);
  }

  return { section, cellElements };
}

/**
 * 挂载桦苑充电口导航。
 * @param {HTMLElement} root
 * @param {{apiBase?: string}} [context]
 * @returns {() => void} unmount
 */
export function mount(root, context = {}) {
  if (!(root instanceof HTMLElement)) {
    throw new TypeError("charging-map: mount 需要一个 HTMLElement 根节点");
  }

  const styleLink = ensureStyles();
  const { section, cellElements } = buildShell();
  root.append(section);

  const refreshButton = section.querySelector("[data-refresh]");
  const listButton = section.querySelector("[data-list]");
  const fullscreenButton = section.querySelector("[data-fullscreen]");
  const statusLine = section.querySelector("[data-status]");
  const notice = section.querySelector("[data-notice]");
  const summary = section.querySelector("[data-summary]");
  const scroll = section.querySelector("[data-scroll]");
  const overlay = section.querySelector("[data-overlay]");
  const closeListButton = section.querySelector("[data-close-list]");
  const freeCount = section.querySelector("[data-free-count]");
  const freeList = section.querySelector("[data-free-list]");

  const state = {
    data: null,
    statusById: new Map(),
    deviceErrors: new Map(),
    structureVerified: false,
    stats: null,
    successfulDevices: 0,
    totalDevices: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
    error: null,
    loading: false,
    currentAbort: null,
    transientNotice: null,
    transientTimer: null,
  };

  let disposed = false;

  const supportsFullscreen = Boolean(
    document.fullscreenEnabled && typeof section.requestFullscreen === "function",
  );
  if (!supportsFullscreen) {
    fullscreenButton.disabled = true;
    fullscreenButton.title = "当前浏览器不支持全屏";
  }

  function setTransientNotice(message) {
    state.transientNotice = message;
    if (state.transientTimer) clearTimeout(state.transientTimer);
    state.transientTimer = setTimeout(() => {
      state.transientNotice = null;
      renderNotice();
    }, 5000);
    renderNotice();
  }

  function describeDeviceErrors() {
    const numbers = [...state.deviceErrors.keys()].sort((a, b) => a - b);
    if (numbers.length === 0) return "";
    const shown = numbers.slice(0, 6).map((no) => `设备 ${no}`);
    const suffix = numbers.length > shown.length ? ` 等 ${numbers.length} 台` : "";
    return `${shown.join("、")}${suffix}`;
  }

  function renderStatusLine() {
    if (state.loading) {
      statusLine.textContent = state.lastSuccessAt
        ? `正在刷新，当前显示 ${formatTime(state.lastSuccessAt)} 的数据…`
        : "正在获取桦苑实时端口状态…";
      return;
    }

    if (state.error && !state.data) {
      statusLine.textContent = `获取失败于 ${formatTime(state.lastFailureAt)}，尚未取得真实端口数据。`;
      return;
    }

    if (state.error && state.data) {
      statusLine.textContent =
        `刷新失败于 ${formatTime(state.lastFailureAt)}；仍显示 ${formatTime(state.lastSuccessAt)} 的真实数据。`;
      return;
    }

    if (state.data) {
      const failed = state.totalDevices - state.successfulDevices;
      const failureText = failed > 0 ? `，其中 ${failed} 台设备查询失败（对应端口未知）` : "";
      const structureText = state.structureVerified ? "" : "，响应结构与已核对版本不一致";
      statusLine.textContent =
        `状态更新于 ${formatTime(state.lastSuccessAt)}（服务器完成查询的时间）` +
        `，已获取 ${state.successfulDevices}/${state.totalDevices} 台设备${failureText}${structureText}。`;
      return;
    }

    statusLine.textContent = "正在获取桦苑实时端口状态…";
  }

  function appendNoticeMessage(messages, variant, text) {
    const item = createElement("div", `charging-map__notice-item is-${variant}`);
    item.append(createElement("span", "charging-map__notice-text", text));
    messages.append(item);
    return item;
  }

  function renderNotice() {
    notice.replaceChildren();

    let hasMessage = false;

    if (state.transientNotice) {
      appendNoticeMessage(notice, "warning", state.transientNotice);
      hasMessage = true;
    }

    if (state.error) {
      const text = state.data
        ? `刷新失败：${state.error.message}。已保留 ${formatTime(state.lastSuccessAt)} 的真实数据，端口状态未被清空。`
        : `无法获取端口状态：${state.error.message}。`;
      const item = appendNoticeMessage(notice, "error", text);
      const retry = createElement("button", "charging-map__button charging-map__button--small", "重试");
      retry.type = "button";
      retry.addEventListener("click", () => refresh());
      item.append(retry);
      hasMessage = true;
    }

    if (!state.error && state.data && state.deviceErrors.size > 0) {
      appendNoticeMessage(
        notice,
        "warning",
        `${state.deviceErrors.size} 台设备查询失败（${describeDeviceErrors()}），对应端口显示为未知，未计入空闲。`,
      );
      hasMessage = true;
    }

    if (!state.error && state.data && !state.structureVerified) {
      appendNoticeMessage(
        notice,
        "warning",
        "接口响应结构与已核对版本不一致，已隐藏空闲/占用/故障统计；无法确认的端口均显示为未知。",
      );
      hasMessage = true;
    }

    notice.hidden = !hasMessage;
  }

  function createSummaryChip(label, value, variant) {
    const chip = createElement("span", `charging-map__chip is-${variant}`);
    chip.append(createElement("span", "charging-map__chip-value", String(value)));
    chip.append(createElement("span", "charging-map__chip-label", label));
    return chip;
  }

  function renderSummary() {
    summary.replaceChildren();

    if (!state.data || !state.stats) {
      summary.hidden = true;
      return;
    }

    summary.hidden = false;

    if (!state.structureVerified) {
      summary.append(createSummaryChip("未知端口", state.stats.unknown, "unknown"));
      summary.append(
        createElement(
          "span",
          "charging-map__summary-note",
          "响应结构未核实，空闲/占用/故障统计已隐藏",
        ),
      );
      return;
    }

    summary.append(createSummaryChip("空闲", state.stats.free, "free"));
    summary.append(createSummaryChip("占用", state.stats.busy, "busy"));
    summary.append(createSummaryChip("故障/未识别", state.stats.unavailable, "unavailable"));
    summary.append(createSummaryChip("未知", state.stats.unknown, "unknown"));
    summary.append(
      createElement(
        "span",
        "charging-map__summary-note",
        `共 ${state.stats.total} 个端口 · 设备 ${state.successfulDevices}/${state.totalDevices} 成功`,
      ),
    );
  }

  function applyPortStatus(element, cell, entry) {
    const status = entry ? entry.status : STATUS.UNKNOWN;
    element.classList.remove(STATUS.FREE, STATUS.BUSY, STATUS.UNAVAILABLE, STATUS.UNKNOWN);
    element.classList.add(status);
    element.dataset.status = status;

    const parts = [`设备 ${cell.deviceNo} 端口 ${cell.portNo}`, STATUS_LABELS[status]];
    if (entry && status === STATUS.UNAVAILABLE) {
      parts.push(`接口状态值 ${entry.value}`);
    }
    if (!entry) {
      const deviceError = state.deviceErrors.get(cell.deviceNo);
      if (deviceError) parts.push(`设备查询失败：${deviceError}`);
    }

    const description = parts.join("，");
    element.title = description;
    element.setAttribute("aria-label", description);
  }

  function renderGrid() {
    for (const cell of PORT_CELLS) {
      const element = cellElements.get(cell.id);
      if (element) applyPortStatus(element, cell, state.statusById.get(cell.id));
    }
  }

  function renderFreeList() {
    freeList.replaceChildren();

    if (!state.data) {
      freeCount.textContent = "尚未取得真实端口数据。";
      return;
    }

    if (!state.structureVerified) {
      freeCount.textContent = "响应结构未核实，暂不提供空闲端口列表。";
      return;
    }

    const free = listFreePorts(state.statusById);
    freeCount.textContent = free.length
      ? `共 ${free.length} 个空闲端口（未知状态不计入）`
      : "当前没有已确认空闲的端口";

    if (free.length === 0) return;

    const list = createElement("ul", "charging-map__free-list");
    for (const item of free) {
      list.append(
        createElement("li", "charging-map__free-item", `设备 ${item.deviceNo} · 端口 ${item.portNo}`),
      );
    }
    freeList.append(list);
  }

  function updateControls() {
    refreshButton.disabled = state.loading;
    refreshButton.textContent = state.loading ? "刷新中…" : "刷新状态";
    listButton.disabled = !state.data;
    if (supportsFullscreen) {
      const active = document.fullscreenElement === section;
      fullscreenButton.textContent = active ? "退出全屏" : "全屏";
      fullscreenButton.setAttribute("aria-pressed", String(active));
    }
  }

  function renderChrome() {
    renderStatusLine();
    renderNotice();
    renderSummary();
    updateControls();
  }

  function applyData(data) {
    const result = buildStatusIndex(data.devices);

    state.data = data;
    state.statusById = result.statusById;
    state.deviceErrors = result.deviceErrors;
    state.successfulDevices = result.successfulDevices;
    state.totalDevices = Array.isArray(data.devices) ? data.devices.length : 0;
    state.structureVerified = result.structureVerified;
    state.stats = computeStats(PORT_CELLS, result.statusById);
    state.lastSuccessAt = new Date(data.fetchedAt);
    state.lastFailureAt = null;
    state.error = null;

    renderGrid();
    renderChrome();
    if (!overlay.hidden) renderFreeList();
  }

  async function refresh() {
    if (disposed || state.loading) return;

    state.loading = true;
    state.error = null;
    updateControls();
    renderStatusLine();

    const controller = new AbortController();
    state.currentAbort = controller;

    try {
      const data = await fetchChargingData({
        apiBase: context.apiBase,
        signal: controller.signal,
      });
      if (disposed) return;
      applyData(data);
    } catch (error) {
      if (disposed || error?.name === "AbortError") return;

      state.error =
        error && typeof error === "object" && typeof error.message === "string"
          ? error
          : new Error("未知错误");
      state.lastFailureAt = new Date();
      if (!state.data) {
        state.statusById = new Map();
        state.deviceErrors = new Map();
        state.structureVerified = false;
        state.stats = null;
        renderGrid();
      }
    } finally {
      if (state.currentAbort === controller) state.currentAbort = null;
      if (!disposed) {
        state.loading = false;
        renderChrome();
        if (!overlay.hidden) renderFreeList();
      }
    }
  }

  function openList() {
    if (!state.data) return;
    renderFreeList();
    overlay.hidden = false;
    listButton.setAttribute("aria-expanded", "true");
    closeListButton.focus();
  }

  function closeList() {
    if (overlay.hidden) return;
    overlay.hidden = true;
    listButton.setAttribute("aria-expanded", "false");
    listButton.focus();
  }

  function onKeydown(event) {
    if (event.key === "Escape" && !overlay.hidden) {
      closeList();
    }
  }

  async function toggleFullscreen() {
    if (!supportsFullscreen) return;
    try {
      if (document.fullscreenElement === section) {
        await document.exitFullscreen();
      } else {
        await section.requestFullscreen();
      }
    } catch {
      setTransientNotice("全屏切换被浏览器拒绝，可继续使用页面滚动查看完整网格。");
    }
  }

  function onFullscreenChange() {
    updateControls();
  }

  function onOverlayClick(event) {
    if (event.target === overlay) closeList();
  }

  refreshButton.addEventListener("click", () => refresh());
  listButton.addEventListener("click", () => openList());
  fullscreenButton.addEventListener("click", () => toggleFullscreen());
  closeListButton.addEventListener("click", () => closeList());
  overlay.addEventListener("click", onOverlayClick);
  document.addEventListener("keydown", onKeydown);
  document.addEventListener("fullscreenchange", onFullscreenChange);

  renderChrome();
  refresh();

  return function unmount() {
    if (disposed) return;
    disposed = true;

    state.currentAbort?.abort();
    if (state.transientTimer) clearTimeout(state.transientTimer);

    document.removeEventListener("keydown", onKeydown);
    document.removeEventListener("fullscreenchange", onFullscreenChange);

    if (document.fullscreenElement === section) {
      document.exitFullscreen().catch(() => {});
    }

    section.remove();
    styleLink?.remove();
  };
}
