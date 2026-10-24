import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { openStore, CairnStore } from '../../src/store/open.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';
import { customSpace, validateScopeSpec, deviceLocal, scopeAllowsRead } from '../../src/core/scope.js';

async function withStore(fn: (store: CairnStore, home: string) => Promise<void> | void): Promise<void> {
  const home = makeTestHome();
  const store = openStore({ home });
  try {
    await fn(store, home);
  } finally {
    store.close();
    cleanupTestHome(home);
  }
}

test('作用域：预设 find-or-create 与指纹复用', async () => {
  await withStore((store) => {
    const s1 = store.scopes.resolvePreset('personal-global');
    const s2 = store.scopes.resolvePreset('personal-global');
    assert.equal(s1.id, s2.id, '同一预设不产生第二行');
    assert.equal(s1.syncPolicy, 'encrypted');
    assert.equal(s1.builtin, true);

    const dev = store.scopes.resolvePreset('device-local', { deviceId: store.identity.deviceId });
    assert.equal(dev.syncPolicy, 'local_only');
    assert.equal(dev.deviceId, store.identity.deviceId);

    assert.throws(() => store.scopes.resolvePreset('device-local'), /deviceId/);

    const proj = store.scopes.resolvePreset('project-global', { projectId: 'proj-A', projectName: '项目A' });
    assert.equal(proj.projectId, 'proj-A');
    const proj2 = store.scopes.resolvePreset('project-global', { projectId: 'proj-A' });
    assert.equal(proj.id, proj2.id);

    const ag = store.scopes.resolvePreset('agent-private', { agentId: 'claude-main' });
    assert.equal(ag.readPolicy, 'allowlist');
    assert.deepEqual(ag.readAllowlist, ['claude-main']);
  });
});

test('作用域：自定义空间默认 local_only，非法名称被拒', async () => {
  await withStore((store) => {
    const spec = customSpace('工作-项目');
    assert.equal(spec.syncPolicy, 'local_only');
    validateScopeSpec(spec);
    const row = store.scopes.createCustom(spec);
    assert.equal(row.syncPolicy, 'local_only');
    const again = store.scopes.createCustom(spec);
    assert.equal(row.id, again.id, '同名同策略复用');

    assert.throws(() => validateScopeSpec(customSpace('a'.repeat(80))), /名称非法/);
    assert.throws(() => validateScopeSpec(customSpace('../etc')), /名称非法/);
  });
});

test('作用域：物理边界校验（设备绑定不可上行、sensitive 必须 local_only、ttl 必须给天数）', async () => {
  assert.throws(() => validateScopeSpec({ ...deviceLocal('dev1'), syncPolicy: 'encrypted' }), /local_only/);
  assert.throws(
    () =>
      validateScopeSpec({
        preset: 'custom', scopeKind: 'custom', spaceName: 'x', projectId: null, deviceId: 'all', agentId: 'all',
        syncPolicy: 'encrypted', readPolicy: 'all_agents', readAllowlist: [], retentionPolicy: 'permanent',
        projectionPolicy: 'none', sensitivity: 'sensitive', ttlDays: null,
      }),
    /sensitive/,
  );
  assert.throws(
    () =>
      validateScopeSpec({
        preset: 'custom', scopeKind: 'custom', spaceName: 'x', projectId: null, deviceId: 'all', agentId: 'all',
        syncPolicy: 'local_only', readPolicy: 'all_agents', readAllowlist: [], retentionPolicy: 'ttl',
        projectionPolicy: 'none', sensitivity: 'normal', ttlDays: null,
      }),
    /ttl/,
  );
  // 项目作用域不响应其他项目查询
  const scope = { deviceId: 'all', agentId: 'all', projectId: 'proj-A', readPolicy: 'all_agents' as const, readAllowlist: [] };
  assert.equal(scopeAllowsRead(scope, { deviceId: 'dev1', agentId: 'ag1', projectId: 'proj-B' }), false);
  assert.equal(scopeAllowsRead(scope, { deviceId: 'dev1', agentId: 'ag1', projectId: 'proj-A' }), true);
  // allowlist 作用域拒绝其他 agent
  const priv = { deviceId: 'all', agentId: 'ag1', projectId: null, readPolicy: 'allowlist' as const, readAllowlist: ['ag1'] };
  assert.equal(scopeAllowsRead(priv, { deviceId: 'dev1', agentId: 'ag2' }), false);
  assert.equal(scopeAllowsRead(priv, { deviceId: 'dev1', agentId: 'ag1' }), true);
});

test('openStore：home 目录布局与只读打开', async () => {
  const home = makeTestHome();
  {
    const store = openStore({ home });
    assert.equal(store.paths.dbPath, join(home, 'data', 'cairn.db'));
    assert.ok(store.identity.deviceId.startsWith('dev_'));
    assert.ok(store.scopes, '仓储装配存在');
    store.close();
  }
  {
    const store = openStore({ home, readOnly: true });
    assert.equal(store.paths.dbPath, join(home, 'data', 'cairn.db'));
    store.close();
  }
  cleanupTestHome(home);
});
