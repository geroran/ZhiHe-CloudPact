/**
 * SSE 解析工具：按空行切分事件帧，提取 event 与 data。
 * `chat_query_v2` 的流式响应是标准 SSE（V2），不接受 V1 的嵌套 data。
 */

function payloadOf(dataLines, eventName) {
  const raw = dataLines.join('\n');
  if (!raw) return null;
  if (/^\s*data:/.test(raw)) return { protocol: 'v1' };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (!parsed.event && eventName) parsed.event = eventName;
  return parsed;
}

/** 解析单个 SSE 帧（不含空行分隔）。 */
export function parseSseFrame(frame) {
  if (!frame || !frame.trim()) return null;

  let eventName = '';
  const dataLines = [];

  for (const rawLine of String(frame).split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(':')) continue;
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''));
    }
  }

  return payloadOf(dataLines, eventName);
}

/**
 * 增量解析器：push 任意文本片段，flush 收尾。
 * @param {(payload: object) => void} onEvent
 */
export function createSseParser(onEvent) {
  let buffer = '';

  function emit(frame) {
    const payload = parseSseFrame(frame);
    if (payload && typeof onEvent === 'function') onEvent(payload);
  }

  return {
    push(chunk) {
      buffer += String(chunk ?? '');
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? '';
      for (const frame of frames) emit(frame);
    },
    flush() {
      if (buffer.trim()) emit(buffer);
      buffer = '';
    }
  };
}
