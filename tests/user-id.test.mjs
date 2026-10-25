import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateUserId,
  isValidUserId,
  resolveUserId,
  USER_ID_MAX_LENGTH
} from '../src/shared/user-id.js';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, value),
    dump: () => Object.fromEntries(values)
  };
}

test('isValidUserId 按接口文档限制为 1-20 字符', () => {
  assert.equal(isValidUserId('a'), true);
  assert.equal(isValidUserId('x'.repeat(USER_ID_MAX_LENGTH)), true);
  assert.equal(isValidUserId('x'.repeat(USER_ID_MAX_LENGTH + 1)), false);
  assert.equal(isValidUserId(''), false);
  assert.equal(isValidUserId('has space'), false);
  assert.equal(isValidUserId(null), false);
});

test('generateUserId 生成的 ID 合法且互不相同', () => {
  const ids = new Set();
  for (let i = 0; i < 500; i += 1) {
    const id = generateUserId();
    assert.equal(isValidUserId(id), true);
    assert.ok(id.length <= USER_ID_MAX_LENGTH);
    ids.add(id);
  }
  assert.equal(ids.size, 500);
});

test('resolveUserId 优先使用显式配置', () => {
  const storage = memoryStorage();
  const result = resolveUserId({ configured: 'demo-user', storage });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { userId: 'demo-user', source: 'configured' });
  assert.deepEqual(storage.dump(), {});
});

test('resolveUserId 拒绝非法配置，不回退到随机账号', () => {
  const result = resolveUserId({ configured: 'x'.repeat(21) });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'USER_ID_INVALID');
});

test('resolveUserId 为每个浏览器生成并持久化独立 ID', () => {
  const storage = memoryStorage();
  const first = resolveUserId({ storage });
  const second = resolveUserId({ storage });

  assert.equal(first.ok, true);
  assert.equal(first.data.source, 'generated');
  assert.equal(second.data.userId, first.data.userId);
  assert.equal(second.data.source, 'storage');
  assert.equal(Object.keys(storage.dump()).length, 1);
});

test('resolveUserId 在存储不可用时仍返回可用身份', () => {
  const brokenStorage = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    }
  };
  const result = resolveUserId({ storage: brokenStorage });
  assert.equal(result.ok, true);
  assert.equal(isValidUserId(result.data.userId), true);
});
