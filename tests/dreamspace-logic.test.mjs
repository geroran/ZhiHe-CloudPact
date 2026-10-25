/** dreamspace-events 纯逻辑测试：刷新结果判定、筛选与进度文案。 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyRefreshResult, filterItems, progressLabel } from '../src/modules/dreamspace-events/logic.js';

test('刷新后 last_sync 推进且详情完整时判定为 done', () => {
  const outcome = classifyRefreshResult(100, {
    last_sync: 200,
    items: [{ aid: '1', quota: 3, state: 'open' }],
  });
  assert.equal(outcome.status, 'done');
  assert.equal(outcome.lastSync, 200);
});

test('首次同步（无基线）只要产生同步时间也判定为 done', () => {
  assert.equal(classifyRefreshResult(null, { last_sync: 200, items: [] }).status, 'done');
});

test('last_sync 没有推进时不能显示同步成功', () => {
  const outcome = classifyRefreshResult(200, { last_sync: 200, items: [] });
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.reason, 'not_advanced');
});

test('后端未记录同步时间时判定失败（保留旧数据）', () => {
  const outcome = classifyRefreshResult(100, { last_sync: null, items: [] });
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.reason, 'no_sync_time');
});

test('上游会话失效（auth.stale）时不显示同步成功', () => {
  const outcome = classifyRefreshResult(100, {
    last_sync: 200,
    auth: { stale: true, msg: '登录已失效' },
    items: [],
  });
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.reason, 'auth_stale');
});

test('部分活动名额未知时标记为 partial 并计数', () => {
  const outcome = classifyRefreshResult(100, {
    last_sync: 200,
    items: [
      { aid: '1', quota: 3 },
      { aid: '2', quota: -2 },
      { aid: '3', quota: -1 },
      { aid: '4', quota: -2 },
    ],
  });
  assert.equal(outcome.status, 'partial');
  assert.equal(outcome.unknown, 2);
});

test('搜索与状态筛选同时生效', () => {
  const items = [
    { name: '校园歌手大赛', state: 'open', category: '文体活动', organizer: '学生会', address: '礼堂' },
    { name: '志愿服务', state: 'full', category: '志愿服务', organizer: '团委' },
    { name: '讲座', state: 'open', category: '学术', organizer: '学院' },
  ];
  assert.equal(filterItems(items, { status: 'open' }).length, 2);
  assert.equal(filterItems(items, { query: '志愿' }).length, 1);
  assert.equal(filterItems(items, { query: '礼堂', status: 'open' })[0].name, '校园歌手大赛');
  assert.equal(filterItems(items, { query: '不存在' }).length, 0);
  assert.equal(filterItems(null, { query: 'x' }).length, 0);
});

test('进度文案区分阶段与计数', () => {
  assert.equal(progressLabel({ phase: 'pages', done: 2, total: 10 }), '读取活动列表，已完成 2/10');
  assert.equal(progressLabel({ phase: 'details', done: 4, total: 0 }), '补充活动详情，已完成 4');
  assert.equal(progressLabel(null), '');
  assert.equal(progressLabel({ phase: 'custom' }), 'custom');
});
