/**
 * dreamspace-events 纯逻辑：不碰 DOM、不发起请求，便于单元测试。
 *
 * 这些判断直接决定界面是否敢说“同步成功”，因此集中在这里：
 * 后端 /api/refresh 只是启动后台线程，任务失败时 busy 仍会回到 false，
 * 所以必须比较 last_sync 是否推进，而不能只看 busy。
 */

export const PHASE_LABELS = {
  list: '读取活动列表',
  pages: '读取活动列表',
  details: '补充活动详情',
};

export function progressLabel(progress) {
  if (!progress || typeof progress !== 'object') return '';
  const phase =
    progress.phase !== undefined && progress.phase !== null && String(progress.phase).trim() !== ''
      ? PHASE_LABELS[String(progress.phase)] || String(progress.phase)
      : '';
  const done = Number.isFinite(progress.done) ? progress.done : null;
  const total = Number.isFinite(progress.total) ? progress.total : null;
  if (done !== null && total !== null && total > 0) {
    return `${phase ? `${phase}，` : ''}已完成 ${done}/${total}`;
  }
  if (done !== null) return `${phase ? `${phase}，` : ''}已完成 ${done}`;
  return phase;
}

/**
 * 刷新结束后的判定。
 *
 * @param beforeLastSync 刷新开始前的 last_sync（可能为 null）
 * @param snapshot       轮询拿到的最近一次 /api/state
 * @returns {{status: 'done'|'partial'|'failed', lastSync: number|null, unknown: number, reason?: string}}
 */
export function classifyRefreshResult(beforeLastSync, snapshot) {
  const prev = Number.isFinite(beforeLastSync) ? beforeLastSync : null;
  const after = Number.isFinite(snapshot?.last_sync) ? snapshot.last_sync : null;

  if (snapshot?.auth && snapshot.auth.stale === true) {
    return { status: 'failed', lastSync: after, unknown: 0, reason: 'auth_stale' };
  }
  if (after === null) {
    return { status: 'failed', lastSync: null, unknown: 0, reason: 'no_sync_time' };
  }
  if (prev !== null && after <= prev) {
    return { status: 'failed', lastSync: after, unknown: 0, reason: 'not_advanced' };
  }

  const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
  const unknown = items.filter((item) => item && item.quota === -2).length;
  if (unknown > 0) {
    return { status: 'partial', lastSync: after, unknown };
  }
  return { status: 'done', lastSync: after, unknown: 0 };
}

function haystack(item) {
  return [item?.name, item?.category, item?.organizer, item?.address]
    .filter((value) => value !== null && value !== undefined && String(value).trim() !== '')
    .join(' ')
    .toLowerCase();
}

/** 前端本地搜索 + 状态筛选（与后端 /api/state 返回结构一致）。 */
export function filterItems(items, filter = {}) {
  const list = Array.isArray(items) ? items : [];
  const status = String(filter.status || 'all');
  const query = String(filter.query || '').trim().toLowerCase();
  return list.filter((item) => {
    if (status !== 'all' && String(item?.state) !== status) return false;
    if (!query) return true;
    return haystack(item).includes(query);
  });
}
