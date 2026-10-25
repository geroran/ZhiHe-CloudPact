/**
 * 主导航注册表。
 * 后续模块实现完成后，在对应条目上补充 load: () => import('../modules/<id>/index.js')。
 * 模块需导出 mount(rootElement, context)，并返回 unmount()。
 */

const icons = {
  classroom:
    '<path d="M5 21V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v17"/><path d="M3 21h18"/><path d="M12 12h.01"/>',
  charging: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>',
  market:
    '<path d="M6 7h12l1 13H5L6 7Z"/><path d="M9 7a3 3 0 0 1 6 0"/><path d="M9 12h6"/>',
  teacher:
    '<circle cx="12" cy="8" r="3.2"/><path d="M5.5 21a6.5 6.5 0 0 1 13 0"/><path d="M17 5h4v4"/>',
  term: '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M8 3v4M16 3v4M3 10h18"/><path d="M8 14h3M8 17h5"/>',
  dream:
    '<path d="M6 21V4"/><path d="M6 4h11l-1.6 4L17 12H6"/><path d="M9 8l1.2 1.2L13 6.5"/>',
  sparkle:
    '<path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z"/><path d="M18.5 14l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z"/>',
  grades:
    '<path d="M4 20h16"/><path d="M7 20v-7"/><path d="M12 20V6"/><path d="M17 20v-4"/><path d="M5 6l4-3 3 3 5-4"/>',
  calendarBus:
    '<rect x="4" y="4" width="16" height="12" rx="2.5"/><path d="M4 10h16"/><path d="M8 16v3M16 16v3"/><circle cx="8" cy="13" r="1"/><circle cx="16" cy="13" r="1"/>',
};

export const modules = [
  {
    id: 'ai-assistant',
    path: '/ai-assistant',
    title: '校园 AI 助手',
    short: '自然语言问答',
    description: '用一句话查询空教室、充电口、课程与校园活动。',
    tone: 'blue',
    icon: icons.sparkle,
    load: () => import('./ai-assistant/index.js'),
  },
  {
    id: 'empty-classroom',
    path: '/empty-classroom',
    title: '空教室查询',
    short: '实时空闲教室',
    description: '按校区、教学周、星期与节次查询当前无排课的教室。',
    tone: 'teal',
    icon: icons.classroom,
    load: () => import('./empty-classroom/index.js'),
  },
  {
    id: 'charging-map',
    path: '/charging-map',
    title: '桦苑充电口',
    short: '端口状态地图',
    description: '查看桦苑充电棚端口的空闲、占用与故障状态。',
    tone: 'amber',
    icon: icons.charging,
    load: () => import('./charging-map/index.js'),
  },
  {
    id: 'market-agent',
    path: '/market-agent',
    title: '校园集市',
    short: '二手闲置检索',
    description: '用自然语言检索校园集市的闲置与求购信息。',
    tone: 'coral',
    icon: icons.market,
    load: () => import('./market-agent/index.js'),
  },
  {
    id: 'teacher-course-search',
    path: '/teacher-course-search',
    title: '教师 / 课程',
    short: '按教师或课程查',
    description: '查询教师课程、上课时间、课程类型与通识类别。',
    tone: 'violet',
    icon: icons.teacher,
    load: () => import('./teacher-course-search/index.js'),
  },
  {
    id: 'term-course-list',
    path: '/term-course-list',
    title: '学期课程',
    short: '本学期课程表',
    description: '按学期查看课程名称、教师与课程安排。',
    tone: 'green',
    icon: icons.term,
    load: () => import('./term-course-list/index.js'),
  },
  {
    id: 'course-grades',
    path: '/course-grades',
    title: '课程给分',
    short: '平均分 · 分数段',
    description: '按课程名或教师查询历史平均分、最高分与分数段分布。',
    tone: 'coral',
    icon: icons.grades,
    load: () => import('./course-grades/index.js'),
  },
  {
    id: 'campus-calendar',
    path: '/campus-calendar',
    title: '校历与校车',
    short: '学期校历 · 校车时刻',
    description: '查看两个学期的校历安排与校车运行时间表。',
    tone: 'rose',
    icon: icons.calendarBus,
    load: () => import('./campus-calendar/index.js'),
  },
  {
    id: 'dreamspace-events',
    path: '/dreamspace-events',
    title: '到梦空间',
    short: '校园活动查询',
    description: '查看校园活动的报名状态、名额与时间安排。',
    tone: 'sky',
    icon: icons.dream,
    load: () => import('./dreamspace-events/index.js'),
  },
];

export const homeModule = modules.find((item) => item.id === 'ai-assistant');
export const gridModules = modules.filter((item) => item.id !== 'ai-assistant');

export function findModule(path) {
  return modules.find((item) => item.path === path) || null;
}
