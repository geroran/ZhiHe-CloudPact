import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MISSING,
  displayField,
  formatDateTime,
  readPost,
  renderMarkdown,
  safeHttpUrl,
  truncateText,
} from '../src/modules/market-agent/helpers.js';

test('displayField 只转换已有值，缺失统一为未提供', () => {
  assert.equal(displayField(undefined), MISSING);
  assert.equal(displayField(null), MISSING);
  assert.equal(displayField(''), MISSING);
  assert.equal(displayField('  '), MISSING);
  assert.equal(displayField(0), '0');
  assert.equal(displayField(500), '500');
  assert.equal(displayField(false), '否');
  assert.equal(displayField([]), MISSING);
});

test('readPost 只读取来源字段，不补造缺失字段', () => {
  const post = readPost({ id: 'p1', title: '显示器', price: 500 });
  assert.equal(post.id, 'p1');
  assert.equal(post.title, '显示器');
  assert.equal(post.price, 500);
  assert.equal(post.location, undefined);
  assert.equal(post.contact, undefined);
  assert.equal('location' in post, true);
});

test('formatDateTime 缺失显示未提供，无效值保持原样', () => {
  assert.equal(formatDateTime(undefined), MISSING);
  assert.equal(formatDateTime('not-a-date'), 'not-a-date');
  assert.match(formatDateTime('2026-10-21T10:00:00+08:00'), /\d{4}/);
});

test('safeHttpUrl 只允许 http/https', () => {
  assert.equal(safeHttpUrl('javascript:alert(1)'), null);
  assert.equal(safeHttpUrl('data:text/html,hi'), null);
  assert.equal(safeHttpUrl('https://example.com/post/1'), 'https://example.com/post/1');
});

test('renderMarkdown 先转义 HTML，不执行脚本', () => {
  const html = renderMarkdown('<img src=x onerror=alert(1)> **加粗** `code`');
  assert.equal(html.includes('<img'), false);
  assert.equal(html.includes('onerror'), true);
  assert.equal(html.includes('&lt;img'), true);
  assert.equal(html.includes('<strong>加粗</strong>'), true);
  assert.equal(html.includes('<code>code</code>'), true);
});

test('renderMarkdown 支持基础列表和段落', () => {
  const html = renderMarkdown('- 第一条\n- 第二条\n\n普通段落');
  assert.match(html, /<ul><li>第一条<\/li><li>第二条<\/li><\/ul>/);
  assert.match(html, /<p>普通段落<\/p>/);
});

test('truncateText 不返回空字符串', () => {
  assert.equal(truncateText(''), MISSING);
  assert.equal(truncateText('显示器', 10), '显示器');
  assert.equal(truncateText('一二三四五六', 3), '一二三…');
});
