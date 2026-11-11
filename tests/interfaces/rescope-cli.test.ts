import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppService } from '../../src/interfaces/app-service.js';
import { openStore } from '../../src/store/open.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';
import { cliEntry } from '../spawn-target.js';

/**
 * `cairn rescope`（add-scope-migration 任务 4.6 / 5.3）：
 * - `--pending --dry-run` 零写入；真执行后作用域已迁移、批注被标为已处置；
 * - 批量 `--ids-file` 部分失败如实计数、不中断；
 * - 退出码：缺 projectId 退 2（用法）、冲突退 4、user_explicit 无 force 退 3（治理拒绝）；
 * - 批注（needs_rescope）本身不改记忆——与 pending_forget 同一回归断言。
 */

function runCli(home: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const target = cliEntry();
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [...target.loader, target.file, '--home', home, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (c) => (stdout += String(c)));
    p.stderr.on('data', (c) => (stderr += String(c)));
    p.on('close', (code) => resolve({ code, stdout, stderr }));
    p.on('error', reject);
  });
}

function scopeOf(home: string, memoryId: string): string {
  const store = openStore({ home, readOnly: true });
  try {
    return String((store.db.get('SELECT scope_id FROM memory WHERE id = ?', memoryId) as { scope_id: string }).scope_id);
  } finally {
    store.close();
  }
}

function statusOf(home: string, memoryId: string): string {
  const store = openStore({ home, readOnly: true });
  try {
    return String((store.db.get('SELECT status FROM memory WHERE id = ?', memoryId) as { status: string }).status);
  } finally {
    store.close();
  }
}

function seed(home: string, contents: string[]): { ids: string[]; service: AppService } {
  const svc = AppService.open(home);
  const ids: string[] = [];
  for (const content of contents) {
    const m = svc.addMemory({ content }).memory!;
    svc.annotateMemory({ memoryId: m.id, disposition: 'needs_rescope', note: '私人项目内容，应隔离' });
    ids.push(m.id);
  }
  return { ids, service: svc };
}

test('批注 needs_rescope 本身不改记忆（回归 add-memory-annotations 断言）', () => {
  const home = makeTestHome();
  const { ids, service } = seed(home, ['内网调试参数']);
  try {
    const store = service.store;
    const mem = store.memories.require(ids[0]!);
    assert.equal(mem.status, 'active');
    assert.equal(mem.scopeId, store.scopes.resolvePreset('personal-global').id);
    const anns = service.listAnnotations({ disposition: 'needs_rescope' });
    assert.equal(anns.length, 1);
    assert.equal(anns[0]!.stale, false);
  } finally {
    service.close();
    cleanupTestHome(home);
  }
});

test('rescope --pending --dry-run：打印清单但零写入', async () => {
  const home = makeTestHome();
  const { ids, service } = seed(home, ['内网调试参数']);
  service.close();
  try {
    const before = scopeOf(home, ids[0]!);
    const r = await runCli(home, ['--json', 'rescope', '--pending', '--scope-preset', 'device-local', '--dry-run']);
    assert.equal(r.code, 0, r.stderr);
    const j = JSON.parse(r.stdout) as { dryRun: boolean; pending: number };
    assert.equal(j.dryRun, true);
    assert.equal(j.pending, 1);
    assert.equal(scopeOf(home, ids[0]!), before, 'dry-run 不迁移');
    // 批注仍是 open
    const svc = AppService.open(home);
    try {
      assert.equal(svc.listAnnotations({ disposition: 'needs_rescope', status: 'open' }).length, 1);
    } finally {
      svc.close();
    }
  } finally {
    cleanupTestHome(home);
  }
});

test('rescope --pending：逐条迁移，批注被标为已处置', async () => {
  const home = makeTestHome();
  const { ids, service } = seed(home, ['内网调试参数', '桌面快捷键习惯']);
  const personalGlobal = service.store.scopes.resolvePreset('personal-global').id;
  service.close();
  try {
    const r = await runCli(home, ['--json', 'rescope', '--pending', '--scope-preset', 'device-local', '--force']);
    assert.equal(r.code, 0, r.stderr);
    const j = JSON.parse(r.stdout) as { results: { memoryId: string; ok: boolean }[] };
    assert.equal(j.results.length, 2);
    assert.ok(j.results.every((x) => x.ok));
    for (const id of ids) assert.notEqual(scopeOf(home, id), personalGlobal, '作用域应已迁出 personal-global');
    const svc = AppService.open(home);
    try {
      assert.equal(svc.listAnnotations({ disposition: 'needs_rescope', status: 'open' }).length, 0);
      assert.equal(svc.listAnnotations({ disposition: 'needs_rescope', status: 'resolved' }).length, 2);
    } finally {
      svc.close();
    }
  } finally {
    cleanupTestHome(home);
  }
});

test('rescope --ids-file：部分失败如实计数，不中断其余条目', async () => {
  const home = makeTestHome();
  const svc = AppService.open(home);
  const ok1 = svc.addMemory({ content: '批量迁移成功项' }).memory!.id;
  const bad = svc.addMemory({ content: '批量迁移冲突项' }).memory!.id;
  const ok2 = svc.addMemory({ content: '批量迁移成功项二' }).memory!.id;
  // 把 bad 弄成冲突状态
  const r1 = svc.store.memories.revise(bad, 'v2', { reason: 'a', author: 't' }, svc.store.identity.deviceId).revision;
  const r2 = svc.store.memories.revise(bad, 'v3', { reason: 'b', author: 't' }, svc.store.identity.deviceId).revision;
  svc.store.conflicts.record({ memoryId: bad, revisionAId: r1.id, revisionBId: r2.id });
  svc.close();

  const file = join(home, 'ids.txt');
  writeFileSync(file, `${ok1}\n${bad}\n${ok2}\n`, 'utf8');
  try {
    const r = await runCli(home, ['--json', 'rescope', '--ids-file', file, '--scope-preset', 'device-local', '--force']);
    assert.equal(r.code, 0, r.stderr);
    const j = JSON.parse(r.stdout) as { total: number; results: { id: string; ok: boolean }[] };
    assert.equal(j.total, 3);
    assert.equal(j.results.filter((x) => x.ok).length, 2, '成功 2 条');
    assert.equal(j.results.filter((x) => !x.ok).length, 1, '失败 1 条（冲突被拒）');
    assert.equal(statusOf(home, bad), 'conflicted', '失败条目状态未变');
    assert.notEqual(scopeOf(home, ok1), scopeOf(home, bad));
    assert.notEqual(scopeOf(home, ok2), scopeOf(home, bad));
  } finally {
    cleanupTestHome(home);
  }
});

test('rescope 缺 projectId 退 2；冲突退 4；user_explicit 无 force 退 3', async () => {
  const home = makeTestHome();
  const svc = AppService.open(home);
  const id = svc.addMemory({ content: '退出码合同' }).memory!.id;
  const conflictId = svc.addMemory({ content: '冲突退出码' }).memory!.id;
  const r1 = svc.store.memories.revise(conflictId, 'v2', { reason: 'a', author: 't' }, svc.store.identity.deviceId).revision;
  const r2 = svc.store.memories.revise(conflictId, 'v3', { reason: 'b', author: 't' }, svc.store.identity.deviceId).revision;
  svc.store.conflicts.record({ memoryId: conflictId, revisionAId: r1.id, revisionBId: r2.id });
  svc.close();
  try {
    const missing = await runCli(home, ['rescope', id, '--scope-preset', 'project-device']);
    assert.equal(missing.code, 2, `缺 projectId 应退 2，实际 ${missing.code}: ${missing.stderr}`);
    const conflicted = await runCli(home, ['rescope', conflictId, '--scope-preset', 'device-local', '--force']);
    assert.equal(conflicted.code, 4, `冲突应退 4，实际 ${conflicted.code}`);
    const noForce = await runCli(home, ['rescope', id, '--scope-preset', 'device-local']);
    assert.equal(noForce.code, 3, `user_explicit 无 force 应退 3，实际 ${noForce.code}`);
  } finally {
    cleanupTestHome(home);
  }
});
