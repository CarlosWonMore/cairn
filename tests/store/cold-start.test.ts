import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeTestHome, cleanupTestHome } from '../helpers.js';

/**
 * 第二轮独立验证 P1 的确定性回归（报告 §2 建议修法 1+4）：
 * 打开时另一进程持有未提交写事务（复现冷启动 SQLITE_READONLY/BUSY 冲突），
 * openStore 必须经有界重试成功且可写入。持锁在独立子进程中进行——
 * 父线程同步阻塞时 setTimeout 永远不会触发，无法在进程内模拟。
 */
test('冷启动回归：打开时写锁被其他进程持有 → 有界重试后成功并可写入', async () => {
  const home = makeTestHome();
  mkdirSync(join(home, 'data'), { recursive: true });
  const dbPath = join(home, 'data', 'cairn.db');

  const holderPath = join(import.meta.dirname ?? '.', 'fixtures', 'lock-holder.mts');
  const child = spawn(process.execPath, ['--import', 'tsx', holderPath, dbPath, '1200'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let holderOut = '';
  child.stdout.on('data', (c) => (holderOut += String(c)));
  child.stderr.on('data', (c) => (holderOut += String(c)));
  const childDone = new Promise<void>((resolve) => child.on('close', () => resolve()));

  try {
    // 父进程在锁被持有期间打开：openStore 的有界重试必须吸收
    const { openStore } = await import('../../src/store/open.js');
    const store = openStore({ home });
    try {
      const scope = store.scopes.resolvePreset('personal-global');
      const m = store.memories.add(
        { kind: 'fact', content: '冷启动竞态回归验证', scopeId: scope.id, authority: 'user_explicit', createdBy: 'cli' },
        store.identity.deviceId,
      );
      assert.equal(m.status, 'active');
      assert.ok(store.db.integrityCheck());
    } finally {
      store.close();
    }
    await childDone;
    assert.ok(holderOut.includes('released'), `持锁子进程应正常提交退出，输出=${holderOut.slice(0, 200)}`);
  } finally {
    child.kill();
    cleanupTestHome(home);
  }
});
