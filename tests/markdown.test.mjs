import assert from 'node:assert/strict';
import test from 'node:test';
import { renderInline, renderMarkdown } from '../src/modules/ai-assistant/markdown.js';

test('Markdown 不会执行模型输出中的原始 HTML', () => {
  const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>');
  assert.equal(html.includes('<script'), false);
  assert.equal(html.includes('<img'), false);
  assert.match(html, /&lt;script&gt;/);
});

test('行内语法支持代码、加粗、斜体、删除线与安全链接', () => {
  const html = renderInline('`a<b>` **粗** *斜* ~~删~~ [站点](https://example.com)');
  assert.match(html, /<code>a&lt;b&gt;<\/code>/);
  assert.match(html, /<strong>粗<\/strong>/);
  assert.match(html, /<em>斜<\/em>/);
  assert.match(html, /<del>删<\/del>/);
  assert.match(html, /<a href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer">站点<\/a>/);
});

test('不安全协议链接保持为纯文本', () => {
  const html = renderInline('[危险](javascript:alert(1))');
  assert.equal(html.includes('<a '), false);
});

test('围栏代码块保留换行并转义 HTML', () => {
  const html = renderMarkdown('```js\nconst a = 1 < 2;\n```');
  assert.equal(
    html,
    '<pre class="ai-code"><code class="language-js">const a = 1 &lt; 2;</code></pre>'
  );
});

test('标题、列表、引用与分隔线', () => {
  const html = renderMarkdown('## 标题\n\n- 一\n- 二\n\n> 引用\n\n---');
  assert.match(html, /<h2>标题<\/h2>/);
  assert.match(html, /<ul><li>一<\/li><li>二<\/li><\/ul>/);
  assert.match(html, /<blockquote>引用<\/blockquote>/);
  assert.match(html, /<hr \/>/);
});

test('GFM 表格渲染为可横向滚动的表格容器', () => {
  const html = renderMarkdown('| 楼栋 | 空教室 |\n| --- | --- |\n| 格物楼 | 3 |');
  assert.match(html, /<div class="ai-table-wrap"><table>/);
  assert.match(html, /<th>楼栋<\/th><th>空教室<\/th>/);
  assert.match(html, /<td>格物楼<\/td><td>3<\/td>/);
});

test('段落内换行转为 br，空输入返回空串', () => {
  assert.equal(renderMarkdown('第一行\n第二行'), '<p>第一行<br />第二行</p>');
  assert.equal(renderMarkdown('   '), '');
});
