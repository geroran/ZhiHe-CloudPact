const WORKSPACE_KEY = 'workspace_id';
const MAX_CONVERSATIONS = 50;
const MAX_MESSAGES = 200;

function makeId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function getWorkspaceId(context = {}) {
  if (context.workspaceId) return String(context.workspaceId);
  try {
    const existing = localStorage.getItem(WORKSPACE_KEY);
    if (existing) return existing;
    const generated = makeId();
    localStorage.setItem(WORKSPACE_KEY, generated);
    return generated;
  } catch {
    return 'local-demo';
  }
}

export function createConversationStore(workspaceId) {
  const listKey = `market-agent:conversations:${workspaceId}`;
  const activeKey = `market-agent:active:${workspaceId}`;
  let memoryList = [];
  let memoryActive = null;
  let storageAvailable = true;

  function readList() {
    if (!storageAvailable) return memoryList;
    try {
      const raw = localStorage.getItem(listKey);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function writeList(conversations) {
    const trimmed = conversations
      .slice()
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, MAX_CONVERSATIONS)
      .map((conv) => ({
        ...conv,
        messages: Array.isArray(conv.messages) ? conv.messages.slice(-MAX_MESSAGES) : [],
      }));
    memoryList = trimmed;
    if (!storageAvailable) return trimmed;
    try {
      localStorage.setItem(listKey, JSON.stringify(trimmed));
    } catch {
      storageAvailable = false;
    }
    return trimmed;
  }

  function readActive() {
    if (!storageAvailable) return memoryActive;
    try {
      return localStorage.getItem(activeKey);
    } catch {
      return memoryActive;
    }
  }

  function writeActive(id) {
    memoryActive = id;
    if (!storageAvailable) return;
    try {
      if (id) localStorage.setItem(activeKey, id);
      else localStorage.removeItem(activeKey);
    } catch {
      storageAvailable = false;
    }
  }

  return {
    list() {
      return readList();
    },
    activeId() {
      return readActive();
    },
    setActive(id) {
      writeActive(id);
    },
    create(title = '新对话') {
      const now = Date.now();
      const conversation = {
        id: makeId(),
        title,
        createdAt: now,
        updatedAt: now,
        messages: [],
      };
      writeList([conversation, ...readList()]);
      writeActive(conversation.id);
      return conversation;
    },
    save(conversation) {
      conversation.updatedAt = Date.now();
      writeList([conversation, ...readList().filter((item) => item.id !== conversation.id)]);
    },
    remove(id) {
      writeList(readList().filter((item) => item.id !== id));
      if (readActive() === id) writeActive(null);
    },
    get(id) {
      return readList().find((item) => item.id === id) || null;
    },
  };
}
