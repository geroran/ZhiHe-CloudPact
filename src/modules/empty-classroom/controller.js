import {
  applyFilters,
  buildQueryPayload,
  defaultSelection,
  describeQuery,
  groupRooms,
  isFilterActive,
  normalizeOptions,
  normalizeRooms,
  normalizeSections,
  toInteger,
  weekdayNumber,
} from './logic.js';

export function defaultFilters() {
  return { keyword: '', minSeats: '', borrowableOnly: false };
}

export function createInitialState(now = new Date()) {
  return {
    optionsStatus: 'idle',
    optionsError: null,
    options: null,
    selection: {
      campus: '',
      week: 1,
      day: weekdayNumber(now),
      sections: [1, 2],
      building: '',
    },
    queryStatus: 'idle',
    queryError: null,
    queryValidationError: null,
    results: [],
    returnedCount: 0,
    hasQueried: false,
    filters: defaultFilters(),
    lastQuery: null,
  };
}

/**
 * 模块状态控制器：负责真实接口调用、查询条件、结果缓存与本地筛选。
 * 不触碰 DOM，视图层订阅状态变化后渲染。
 */
export function createEmptyClassroomController({ api, now = () => new Date() } = {}) {
  if (!api || typeof api.getOptions !== 'function' || typeof api.query !== 'function') {
    throw new TypeError('createEmptyClassroomController 需要 api.getOptions 与 api.query');
  }

  let state = createInitialState(now());
  const listeners = new Set();
  let optionsToken = 0;
  let queryToken = 0;
  let optionsAbort = null;
  let queryAbort = null;
  let destroyed = false;

  function getState() {
    return state;
  }

  function emit() {
    for (const listener of listeners) listener(state);
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener 必须是函数');
    listeners.add(listener);
    listener(state);
    return () => listeners.delete(listener);
  }

  function setOptionsFailure(message) {
    state = {
      ...state,
      optionsStatus: 'error',
      optionsError: message,
      options: null,
      results: [],
      returnedCount: 0,
      hasQueried: false,
      lastQuery: null,
      queryStatus: 'idle',
      queryError: null,
      queryValidationError: null,
      filters: defaultFilters(),
      selection: { ...state.selection, campus: '', building: '' },
    };
    emit();
  }

  async function loadOptions() {
    if (destroyed) return;
    const token = ++optionsToken;

    if (optionsAbort) optionsAbort.abort();
    optionsAbort = typeof AbortController === 'function' ? new AbortController() : null;

    // 重新加载选项时中止在途查询，避免旧查询结果覆盖新选项状态。
    queryToken += 1;
    if (queryAbort) queryAbort.abort();

    state = {
      ...state,
      optionsStatus: 'loading',
      optionsError: null,
      options: null,
      queryStatus: 'idle',
      queryError: null,
      queryValidationError: null,
      results: [],
      returnedCount: 0,
      hasQueried: false,
      filters: defaultFilters(),
      lastQuery: null,
    };
    emit();

    const result = await api.getOptions({ signal: optionsAbort ? optionsAbort.signal : undefined });
    if (destroyed || token !== optionsToken || result.aborted) return;

    if (!result.ok) {
      setOptionsFailure(result.message || '选项接口请求失败');
      return;
    }

    const normalized = normalizeOptions(result.data);
    if (!normalized.ok) {
      setOptionsFailure(normalized.message);
      return;
    }

    state = {
      ...state,
      optionsStatus: 'ready',
      optionsError: null,
      options: normalized.options,
      selection: defaultSelection(normalized.options, now()),
    };
    emit();
  }

  function updateSelection(patch) {
    if (destroyed) return;
    const next = { ...state.selection };

    if (Object.prototype.hasOwnProperty.call(patch, 'campus')) {
      next.campus = String(patch.campus ?? '');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'week')) {
      const week = toInteger(patch.week);
      if (week !== null) next.week = week;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'day')) {
      const day = toInteger(patch.day);
      if (day !== null) next.day = day;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'building')) {
      next.building = String(patch.building ?? '');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'sections')) {
      const normalized = normalizeSections(patch.sections);
      if (normalized.ok) next.sections = normalized.sections;
    }

    state = { ...state, selection: next, queryValidationError: null };
    emit();
  }

  function toggleSection(section) {
    if (destroyed) return;
    const value = toInteger(section);
    if (value === null || value < 1 || value > 12) return;

    const current = state.selection.sections;
    const sections = current.includes(value)
      ? current.filter((item) => item !== value)
      : [...current, value].sort((a, b) => a - b);

    state = {
      ...state,
      selection: { ...state.selection, sections },
      queryValidationError: null,
    };
    emit();
  }

  function setSections(sections) {
    updateSelection({ sections });
  }

  async function query() {
    if (destroyed) return;

    if (state.optionsStatus !== 'ready' || !state.options) {
      state = {
        ...state,
        queryValidationError:
          state.optionsStatus === 'error' ? '选项接口失败，无法查询' : '查询选项尚未加载完成',
      };
      emit();
      return;
    }

    const built = buildQueryPayload(state.selection, state.options.maxWeek);
    if (!built.ok) {
      state = { ...state, queryValidationError: built.message };
      emit();
      return;
    }

    const token = ++queryToken;
    if (queryAbort) queryAbort.abort();
    queryAbort = typeof AbortController === 'function' ? new AbortController() : null;

    state = {
      ...state,
      queryStatus: 'loading',
      queryError: null,
      queryValidationError: null,
      hasQueried: true,
      filters: defaultFilters(),
      lastQuery: built.payload,
    };
    emit();

    const result = await api.query(built.payload, {
      signal: queryAbort ? queryAbort.signal : undefined,
    });
    if (destroyed || token !== queryToken || result.aborted) return;

    if (!result.ok) {
      state = {
        ...state,
        queryStatus: 'error',
        queryError: result.message || '查询失败',
        results: [],
        returnedCount: 0,
      };
      emit();
      return;
    }

    const normalized = normalizeRooms(result.data);
    if (!normalized.ok) {
      state = {
        ...state,
        queryStatus: 'error',
        queryError: normalized.message,
        results: [],
        returnedCount: 0,
      };
      emit();
      return;
    }

    state = {
      ...state,
      queryStatus: 'success',
      queryError: null,
      results: normalized.rooms,
      returnedCount: normalized.rooms.length,
    };
    emit();
  }

  function setFilters(patch) {
    if (destroyed) return;
    const next = { ...state.filters };

    if (Object.prototype.hasOwnProperty.call(patch, 'keyword')) {
      next.keyword = String(patch.keyword ?? '');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'minSeats')) {
      next.minSeats = patch.minSeats === null || patch.minSeats === undefined ? '' : String(patch.minSeats);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'borrowableOnly')) {
      next.borrowableOnly = patch.borrowableOnly === true;
    }

    state = { ...state, filters: next };
    emit();
  }

  function resetFilters() {
    if (destroyed) return;
    state = { ...state, filters: defaultFilters() };
    emit();
  }

  function getVisibleRooms() {
    return applyFilters(state.results, state.filters);
  }

  function getGroups() {
    return groupRooms(getVisibleRooms());
  }

  function getCounts() {
    return { total: state.returnedCount, visible: getVisibleRooms().length };
  }

  function canQuery() {
    return state.optionsStatus === 'ready' && state.options !== null;
  }

  function isFiltering() {
    return isFilterActive(state.filters);
  }

  function getQueryDescription() {
    return describeQuery(state.lastQuery);
  }

  function destroy() {
    destroyed = true;
    if (optionsAbort) optionsAbort.abort();
    if (queryAbort) queryAbort.abort();
    listeners.clear();
  }

  return {
    getState,
    subscribe,
    loadOptions,
    updateSelection,
    toggleSection,
    setSections,
    query,
    setFilters,
    resetFilters,
    getVisibleRooms,
    getGroups,
    getCounts,
    canQuery,
    isFiltering,
    getQueryDescription,
    destroy,
  };
}
