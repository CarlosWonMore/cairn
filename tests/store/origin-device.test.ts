import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppService } from '../../src/interfaces/app-service.js';
import { openStore } from '../../src/store/open.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';

/**
 * 归属设备（add-cloud-preserve-mode D7 / tasks 0.4）：
 * 本机创建记录本机、修订/迁移不改写、存量未知如实展示、不参与读取授权。
 */

test('本机创建记录本机设备；修订与作用域迁移不改写归属设备', () => {
  const home = makeTestHome('cairn-origin-');
  const service = AppService.open(home);
  try {
    const deviceId = service.store.identity.deviceId;
    const r = service.addMemory({ content: '本机创建的记忆', kind: 'fact' });
    const mem = r.memory!;
    assert.equal(mem.originDeviceId, deviceId, '本机创建 → 本机设备标识');

    // 修订不改写（溯源事实不是可编辑属性）
    service.reviseMemory(mem.id, '本机创建的记忆（已更正）', { reason: '更正' });
    assert.equal(service.store.memories.require(mem.id).originDeviceId, deviceId);

    // 迁移作用域不改写
    service.rescopeMemory(mem.id, { scopePreset: 'device-local', force: true });
    assert.equal(service.store.memories.require(mem.id).originDeviceId, deviceId);

    // 遗忘不改写（墓碑之上仍可读溯源）
    service.forgetMemory(mem.id, '测试遗忘');
    assert.equal(service.store.memories.require(mem.id).originDeviceId, deviceId);
  } finally {
    service.close();
    cleanupTestHome(home);
  }
});

test('存量记忆归属设备未知（NULL）如实展示；载荷暴露；不参与读取授权', () => {
  const home = makeTestHome('cairn-origin2-');
  const service = AppService.open(home);
  try {
    const store = service.store;
    const scope = service.resolveScope({ preset: 'personal-global' });
    // 模拟 v7 之前的存量行：直写不带 origin_device_id
    store.db.run(
      `INSERT INTO memory (id, owner_id, kind, content, normalized_content, scope_id, status, authority,
         confidence, observed_at, sensitivity, content_hash, created_by, created_at, updated_at, usage_count)
       VALUES ('legacy0001', 'local-user', 'fact', '变更前的老记忆', '变更前的老记忆', ?, 'active', 'user_explicit',
         1, ?, 'normal', 'legacyhash0001', 'cli', ?, ?, 0)`,
      scope.id,
      new Date().toISOString(),
      new Date().toISOString(),
      new Date().toISOString(),
    );
    const legacy = store.memories.get('legacy0001')!;
    assert.equal(legacy.originDeviceId, null, '存量行 NULL = 未知');
    // 详情载荷如实携带（不隐藏未知状态）
    const detail = service.showMemory('legacy0001') as { memory: { originDeviceId: string | null } };
    assert.equal(detail.memory.originDeviceId, null);
    // 控制台视图同样如实
    const row = store.db.get('SELECT origin_device_id AS d FROM memory WHERE id = ?', 'legacy0001');
    assert.equal(row?.d ?? null, null);

    // 授权不受归属设备影响：同一作用域、不同归属设备，读取判定一致
    const q = { deviceId: store.identity.deviceId, agentId: 'cli' };
    assert.equal(store.scopes.allowsRead(scope.id, q), true, 'personal-global 对 user 通道可读');
    // device-local 作用域对其他设备不可读——判定只看作用域，不看归属设备
    const dl = service.resolveScope({ preset: 'device-local' });
    assert.equal(store.scopes.allowsRead(dl.id, { deviceId: 'dev_other_device', agentId: 'cli' }), false, '按作用域拒绝（归属设备无关）');
    assert.equal(store.scopes.allowsRead(dl.id, { deviceId: store.identity.deviceId, agentId: 'cli' }), true);
  } finally {
    service.close();
    cleanupTestHome(home);
  }
});
