export const MISSING = '未提供';

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 只展示来源响应中实际存在的字段；缺失时统一显示“未提供”。
 * 不补造默认值，也不推断同义字段。
 */
export function displayField(value) {
  if (value === null || value === undefined) return MISSING;
  if (typeof value === 'string') return value.trim() ? value : MISSING;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : MISSING;
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) {
    return value.length ? value.map((item) => displayField(item)).join('、') : MISSING;
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return MISSING;
    }
  }
  return String(value);
}

export function formatDateTime(value) {
  if (value === null || value === undefined || value === '') return MISSING;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const millis = value < 1e12 ? value * 1000 : value;
    const date = new Date(millis);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString('zh-CN', { hour12: false });
    }
    return String(value);
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime()) && /\d{4}[-/]/.test(value)) {
      return date.toLocaleString('zh-CN', { hour12: false });
    }
    return value;
  }
  return displayField(value);
}

export function safeHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export function truncateText(value, max = 20) {
  const text = String(value ?? '').trim();
  if (!text) return MISSING;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * 安全的基础 Markdown 渲染：先整体转义 HTML，再只转换少量行内/块级语法。
 * 不把模型输出中的链接、HTML 或脚本当作可执行内容。
 */
export function renderMarkdown(text) {
  const source = escapeHtml(text ?? '');
  const lines = source.split(/\r?\n/);
  const html = [];
  let listOpen = false;
  let paragraph = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      html.push(`<p>${paragraph.map((line) => inline(line)).join('<br>')}</p>`);
      paragraph = [];
    }
  };
  const closeList = () => {
    if (listOpen) {
      html.push('</ul>');
      listOpen = false;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const listMatch = trimmed.match(/^[-*]\s+(.*)$/);
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (listMatch) {
      flushParagraph();
      if (!listOpen) {
        html.push('<ul>');
        listOpen = true;
      }
      html.push(`<li>${inline(listMatch[1])}</li>`);
      continue;
    }
    closeList();
    if (headingMatch) {
      flushParagraph();
      html.push(`<h4>${inline(headingMatch[2])}</h4>`);
      continue;
    }
    if (!trimmed) {
      flushParagraph();
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  closeList();
  return html.join('');
}

function inline(text) {
  return text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

/** 返回帖子中实际存在的字段；缺失字段为 undefined，由 UI 显示“未提供”。 */
export function readPost(post) {
  const source = post && typeof post === 'object' ? post : {};
  return {
    id: source.id,
    title: source.title,
    content: source.content,
    price: source.price,
    category: source.category,
    location: source.location,
    contact: source.contact,
    createdAt: source.created_at,
    url: source.url,
    likeCount: source.like_count,
    commentCount: source.comment_count,
    source: source.source,
  };
}
