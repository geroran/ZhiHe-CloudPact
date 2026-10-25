/** dreamspace-events 视图工具：只做 DOM 构建与字段展示，不发起请求。 */

export const STATE_LABELS = {
  open: '报名中',
  full: '已满',
  soon: '即将开始',
  running: '进行中',
  ended: '已结束',
  unknown: '未知',
};

const STATE_TONES = new Set(['open', 'full', 'soon', 'running', 'ended', 'unknown']);

export function el(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = String(options.text);
  if (options.attrs) {
    for (const [key, value] of Object.entries(options.attrs)) {
      if (value !== undefined && value !== null) node.setAttribute(key, String(value));
    }
  }
  if (options.props) Object.assign(node, options.props);
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function stateLabel(state) {
  return STATE_LABELS[String(state)] || '未知';
}

export function stateTone(state) {
  const key = String(state);
  return STATE_TONES.has(key) ? key : 'unknown';
}

/** quota: -1 不限，-2 未知，0 已满，其余为剩余名额。 */
export function quotaText(quota) {
  if (quota === -1) return '不限';
  if (quota === -2) return '未知';
  if (typeof quota === 'number' && Number.isFinite(quota)) {
    return quota <= 0 ? '已满' : `剩余 ${quota}`;
  }
  return '未知';
}

export function numberText(value, suffix = '') {
  if (typeof value === 'number' && Number.isFinite(value)) return `${value}${suffix}`;
  if (typeof value === 'string' && value.trim() !== '') return `${value.trim()}${suffix}`;
  return '未提供';
}

function formatUnixSeconds(seconds) {
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 列表时间字段是 Unix 秒；详情字段可能是时间戳、日期文本或时间窗字符串。
 * 数字/数字字符串做本地时间格式化，其余原样保留，避免猜格式。
 */
export function formatTime(value) {
  if (value === null || value === undefined || value === '') return '未提供';
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value <= 0) return '未提供';
    return formatUnixSeconds(value) || '未提供';
  }
  const text = String(value).trim();
  if (!text) return '未提供';
  if (/^\d{10}$/.test(text)) {
    return formatUnixSeconds(Number(text)) || text;
  }
  if (/^\d{13}$/.test(text)) {
    return formatUnixSeconds(Number(text) / 1000) || text;
  }
  return text;
}

export function formatSyncTime(lastSync) {
  if (typeof lastSync !== 'number' || !Number.isFinite(lastSync) || lastSync <= 0) {
    return '尚未同步';
  }
  return formatUnixSeconds(lastSync) || '尚未同步';
}

export function boolText(value) {
  if (value === true) return '是';
  if (value === false) return '否';
  return '未提供';
}

/** 详情接口白名单字段（规格 3.4）。 */
export const DETAIL_ROWS = [
  ['activityId', '活动 ID'],
  ['joindate', '报名时间'],
  ['startdate', '活动时间'],
  ['startdateDate', '活动开始'],
  ['enddate', '活动结束'],
  ['schoolname', '主办单位'],
  ['address', '活动地点'],
  ['catalog2name', '活动类别'],
  ['levelText', '活动级别'],
  ['joinrangeText', '报名范围'],
  ['joinWayDesc', '报名方式'],
  ['joinWay', '报名方式编码'],
  ['score', '积分/学分'],
  ['joinStatus', '报名状态'],
  ['countdownText', '倒计时'],
];

export function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}
