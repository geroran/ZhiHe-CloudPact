import assert from 'node:assert/strict';
import test from 'node:test';
import { createSseParser, parseSseFrame } from '../src/modules/ai-assistant/sse.js';

test('解析标准 SSE 帧的 event 与 data', () => {
  const payload = parseSseFrame(
    'event: message\ndata: {"event":"message","answer":"你"}\n'
  );
  assert.deepEqual(payload, { event: 'message', answer: '你' });
});

test('V1 嵌套 data 被标记为协议不匹配', () => {
  const payload = parseSseFrame('event: text\ndata:data: {"event":"message","answer":"你"}');
  assert.deepEqual(payload, { protocol: 'v1' });
});

test('忽略注释与心跳行', () => {
  assert.equal(parseSseFrame(': keep-alive\n\n'), null);
});

test('跨片段的帧在 push 后正确拼装', () => {
  const events = [];
  const parser = createSseParser((payload) => events.push(payload));

  parser.push('event: message_start\ndata: {"event":"message_start","task_id":"t1"}\n\n');
  parser.push('event: message\ndata: {"event":"message","ans');
  parser.push('wer":"你好"}\n\nevent: message_end\ndata: {"even');
  parser.push('t":"message_end","answer":"你好"}\n\n');

  assert.deepEqual(events.map((event) => event.event), [
    'message_start',
    'message',
    'message_end'
  ]);
  assert.equal(events[1].answer, '你好');
});

test('flush 处理未以空行结尾的最后一帧', () => {
  const events = [];
  const parser = createSseParser((payload) => events.push(payload));
  parser.push('event: message\ndata: {"event":"message","answer":"尾部"}');
  assert.equal(events.length, 0);
  parser.flush();
  assert.equal(events.length, 1);
  assert.equal(events[0].answer, '尾部');
});
