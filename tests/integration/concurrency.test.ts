import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { makeTestHome, cleanupTestHome } from '../helpers.js';

/**
 * 并发与故障注入集成（任务 7.2）：4 进程同时写同一本地库；
 * 记录完整、无死锁挂起、WAL busy_timeout 内完成而非无限等待。
 */

import { concurrentWriterEntry } from '../spawn-target.js';
const writerTarget = concurrentWriterEntry();

function runWriter(home: string, index: number): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [...writerTarget.loader, writerTarget.file, String(index)], {
      env: { ...process.env, CAIRN_TEST_HOME: home },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    p.stdout!.on('data', (c) => (stdout += String(c)));
    p.on('close', (code) => resolve({ code, stdout }));
    p.on('error', reject);
  });
}

test('并发：4 进程同时写入同一本地库，记录完整且无死锁', { timeout: 120_000 }, async () => {
  const home = makeTestHome();
  try {
    const results = await Promise.all([runWriter(home, 1), runWriter(home, 2), runWriter(home, 3), runWriter(home, 4)]);
    for (const [i, r] of results.entries()) {
      assert.equal(r.code, 0, `进程 ${i + 1} 退出码 ${r.code}: ${r.stdout.slice(0, 200)}`);
      const summary = JSON.parse(r.stdout.trim().split('\n').pop()!) as { ok: number };
      assert.equal(summary.ok, 5, `进程 ${i + 1} 完成全部 5 条写入`);
    }

    // 独立核验：总写入数 = 20，内容无缺失、无碰撞，库完整
    const { openStore } = await import('../../src/store/index.js');
    const store = openStore({ home, readOnly: true });
    try {
      const active = store.memories.list({ status: 'active', limit: 100 });
      assert.equal(active.length, 20, `应 20 条，实际 ${active.length}`);
      const hashes = new Set(active.map((m) => m.contentHash));
      assert.equal(hashes.size, 20, '规范化哈希无碰撞');
      assert.ok(store.db.integrityCheck());
      assert.equal(store.db.foreignKeyCheck().length, 0);
    } finally {
      store.close();
    }
  } finally {
    cleanupTestHome(home);
  }
});
