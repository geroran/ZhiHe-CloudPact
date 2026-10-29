import assert from 'node:assert/strict';
import test from 'node:test';
import { assertFrontendEnv } from '../scripts/frontend-env.mjs';
import { readRuntimeConfig } from '../src/shared/config.js';

test('无配置默认走代理，运行配置不返回旧凭据', () => {
  assert.equal(readRuntimeConfig({}).data.transport, 'proxy');
  const result = readRuntimeConfig({ __AGENT_CONFIG__: { transport: 'proxy', appId: 'private-id', apiKey: 'private-key' } });
  assert.equal(JSON.stringify(result).includes('private-'), false);
  assert.equal(readRuntimeConfig({ __AGENT_CONFIG__: { transport: 'direct' } }).ok, false);
});

test('前端构建检查拒绝凭据且不在错误中显示值', () => {
  assert.doesNotThrow(() => assertFrontendEnv({ VITE_AGENT_TRANSPORT: 'proxy' }));
  for (const key of ['VITE_AGENT_APP_ID', 'VITE_AGENT_API_KEY']) {
    assert.throws(() => assertFrontendEnv({ [key]: 'private-secret' }), error => error.message.includes(key) && !error.message.includes('private-secret'));
  }
  assert.throws(() => assertFrontendEnv({ VITE_AGENT_TRANSPORT: 'direct' }));
});
