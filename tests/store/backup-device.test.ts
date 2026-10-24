import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFileSync, existsSync, cpSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { openStore, CairnStore, backupDatabase, verifyBackup, restoreFromBackup, tableCounts } from '../../src/store/index.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';

test('备份恢复：计数一致、损坏检测、恢复后可用', () => {
  const home = makeTestHome();
  const home2 = makeTestHome();
  try {
    const store = openStore({ home });
    const scope = store.scopes.resolvePreset('personal-global');
    store.memories.add({ kind: 'fact', content: '备份前的事实甲', scopeId: scope.id, authority: 'user_explicit', createdBy: 'cli' }, store.identity.deviceId);
    store.memories.add({ kind: 'fact', content: '备份前的事实乙', scopeId: scope.id, authority: 'user_explicit', createdBy: 'cli' }, store.identity.deviceId);
    const backupPath = join(home, 'backups', 'test-backup.db');
    const backup = backupDatabase(store.db, backupPath);
    assert.ok(backup.bytes > 0);
    assert.ok(backup.sha256.length === 64);
    assert.equal(backup.counts.memory, 2);

    const v = verifyBackup(backupPath, { memory: 2 });
    assert.equal(v.ok, true, v.problems.join(';'));

    // 备份后继续写入 → 备份仍是旧状态
    store.memories.add({ kind: 'fact', content: '备份后的新事实', scopeId: scope.id, authority: 'user_explicit', createdBy: 'cli' }, store.identity.deviceId);
    assert.equal(tableCounts(store.db).memory, 3);
    store.close();

    // 恢复到新目录并核对
    const targetDb = join(home2, 'data', 'cairn.db');
    restoreFromBackup(backupPath, targetDb);
    const restored = openStore({ home: home2, readOnly: true });
    const counts = tableCounts(restored.db);
    assert.equal(counts.memory, 2, '恢复到备份时点');
    restored.close();

    // 损坏文件拒绝恢复
    const corrupt = join(home, 'backups', 'corrupt.db');
    writeFileSync(corrupt, Buffer.from('this is not a sqlite database at all'));
    const vr = verifyBackup(corrupt);
    assert.equal(vr.ok, false);
    assert.throws(() => restoreFromBackup(corrupt, join(home2, 'data', 'cairn.db')), /校验失败/);
  } finally {
    cleanupTestHome(home);
    cleanupTestHome(home2);
  }
});

test('设备克隆：目录复制后旧身份写入被暂停，re-enroll 恢复', () => {
  const home = makeTestHome();
  const cloneHome = makeTestHome();
  try {
    let store = openStore({ home });
    const scope = store.scopes.resolvePreset('personal-global');
    store.memories.add({ kind: 'fact', content: '克隆前数据', scopeId: scope.id, authority: 'user_explicit', createdBy: 'cli' }, store.identity.deviceId);
    store.close();

    // 整目录克隆（模拟把数据目录复制到另一台设备）
    cpSync(home, cloneHome, { recursive: true });

    // 克隆副本：身份 nonce 与库一致（复制来的），可写——这是"同一设备身份"的问题场景
    const cloneStore = openStore({ home: cloneHome });
    // 真正的克隆检测场景：原设备继续演进（nonce 变化/或另一副本先 re-enroll）
    // 构造：把克隆库中的 nonce 改成不同值 → 打开时判定克隆
    cloneStore.close();
    const raw = new DatabaseSync(join(cloneHome, 'data', 'cairn.db'));
    raw.exec("UPDATE device SET instance_nonce = 'different-nonce-from-another-writer'");
    raw.close();

    const reopened = openStore({ home: cloneHome });
    try {
      assert.equal(reopened.cloneCheck.cloned, true, 'nonce 不一致判定为克隆');
      assert.throws(
        () =>
          reopened.memories.add(
            { kind: 'fact', content: '克隆写入', scopeId: reopened.scopes.resolvePreset('personal-global').id, authority: 'user_explicit', createdBy: 'cli' },
            reopened.identity.deviceId,
          ),
        /克隆|E_DEVICE_CLONED|设备/,
      );
      // 读取仍允许
      assert.ok(reopened.memories.list().length >= 1);

      // re-enroll：生成新身份并恢复写入
      const r = reopened.reEnroll();
      assert.ok(r.identity.deviceId !== r.old.deviceId, '新身份独立');
      assert.equal(reopened.cloneCheck.cloned, false);
      const scope2 = reopened.scopes.resolvePreset('personal-global');
      reopened.memories.add({ kind: 'fact', content: '重新登记后的写入', scopeId: scope2.id, authority: 'user_explicit', createdBy: 'cli' }, reopened.identity.deviceId);
    } finally {
      reopened.close();
    }
    assert.ok(existsSync(join(cloneHome, 'data', 'device.json')));
  } finally {
    cleanupTestHome(home);
    cleanupTestHome(cloneHome);
  }
});
