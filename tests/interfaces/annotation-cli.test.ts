import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { AppService } from '../../src/interfaces/app-service.js';
import { openStore } from '../../src/store/open.js';
import { loadAnnotationsFile } from '../../src/interfaces/console/annotations.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';
import { cliEntry } from '../spawn-target.js';

/**
 * `cairn forget --pending`（design D3 / 任务 3.4）：
 * - `--dry-run` 零写入；
 * - 真执行后记忆为 tombstoned、outbox 有既有的 memory_tombstone 任务、批注被标为已处理；
 * - 非 --json 时先打印完整清单，再逐条报告结果（spec「命令行批量确认」）。
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

function seed(home: string, contents: string[]): { ids: string[] } {
  const svc = AppService.open(home);
  const ids: string[] = [];
  for (const content of contents) {
    const m = svc.addMemory({ content }).memory!;
    svc.annotateMemory({ memoryId: m.id, disposition: 'pending_forget', note: '看着像过期了' });
    ids.push(m.id);
  }
  svc.close();
  return { ids };
}

function statuses(home: string): Record<string, string> {
  const store = openStore({ home, readOnly: true });
  try {
    const out: Record<string, string> = {};
    for (const r of store.db.all('SELECT id, status FROM memory')) out[String(r['id'])] = String(r['status']);
    return out;
  } finally {
    store.close();
  }
}

test('forget --pending --dry-run：打印清单但零写入', async () => {
  const home = makeTestHome('cairn-annot-cli-');
  try {
    const { ids } = seed(home, ['待删记忆一：部署窗口已过时。', '待删记忆二：这条也不再适用。']);
    const r = await runCli(home, ['--json', 'forget', '--pending', '--dry-run']);
    assert.equal(r.code, 0, r.stderr);
    const body = JSON.parse(r.stdout) as { dryRun: boolean; pending: number; items: { memoryId: string }[]; results: unknown[] };
    assert.equal(body.dryRun, true);
    assert.equal(body.pending, 2);
    assert.deepEqual(body.items.map((x) => x.memoryId).sort(), ids.slice().sort());
    assert.equal(body.results.length, 0, 'dry-run 不执行任何删除');

    assert.deepEqual(Object.values(statuses(home)).sort(), ['active', 'active']);
    const store = openStore({ home, readOnly: true });
    try {
      assert.equal(Number(store.db.scalar('SELECT COUNT(*) AS n FROM tombstone') ?? 0), 0, 'dry-run 不得写墓碑');
      assert.equal(
        Number(store.db.scalar("SELECT COUNT(*) AS n FROM outbox_job WHERE payload LIKE '%memory_tombstone%'") ?? 0),
        0,
        'dry-run 不得入队墓碑上行',
      );
    } finally {
      store.close();
    }
    assert.equal(
      loadAnnotationsFile(home).items.filter((x) => x.status === 'open').length,
      2,
      'dry-run 不应改动批注状态',
    );
  } finally {
    cleanupTestHome(home);
  }
});

test('forget --pending：逐条遗忘，走既有 tombstone 与 outbox，批注标为已处理', async () => {
  const home = makeTestHome('cairn-annot-cli-');
  try {
    const { ids } = seed(home, ['待删记忆一：确认删除。', '待删记忆二：同样确认删除。']);
    const r = await runCli(home, ['--json', 'forget', '--pending']);
    assert.equal(r.code, 0, r.stderr);
    const body = JSON.parse(r.stdout) as {
      dryRun: boolean;
      results: { memoryId: string; ok: boolean; status?: string }[];
    };
    assert.equal(body.dryRun, false);
    assert.equal(body.results.length, 2);
    assert.ok(body.results.every((x) => x.ok && x.status === 'tombstoned'), JSON.stringify(body.results));

    assert.deepEqual(Object.values(statuses(home)).sort(), ['tombstoned', 'tombstoned']);
    const store = openStore({ home, readOnly: true });
    try {
      assert.equal(Number(store.db.scalar('SELECT COUNT(*) AS n FROM tombstone') ?? 0), 2);
      const jobs = store.db.all(
        "SELECT payload, job_type, status FROM outbox_job WHERE payload LIKE '%memory_tombstone%' ORDER BY id",
      );
      assert.equal(jobs.length, 2, '每条删除必须走既有 sync_upstream 入队');
      assert.ok(jobs.every((j) => String(j['job_type']) === 'sync_upstream'));
      assert.ok(jobs.every((j) => String(j['status']) === 'pending'));
    } finally {
      store.close();
    }
    const file = loadAnnotationsFile(home);
    assert.equal(file.items.filter((x) => x.status === 'resolved').length, 2);
    assert.ok(file.items.every((x) => x.resolvedBy === 'cli:forget'));
    assert.ok(file.items.every((x) => x.resolvedAt != null));

    // 再跑一次：清单为空，不重复删除
    const again = await runCli(home, ['--json', 'forget', '--pending']);
    assert.equal(again.code, 0);
    assert.equal((JSON.parse(again.stdout) as { pending: number }).pending, 0);
    assert.deepEqual(Object.keys(statuses(home)).sort(), ids.slice().sort());
  } finally {
    cleanupTestHome(home);
  }
});

test('forget --pending（非 JSON）：先打印全部清单，再逐条报告结果', async () => {
  const home = makeTestHome('cairn-annot-cli-');
  try {
    const { ids } = seed(home, ['唯一一条待删记忆：先列清单再删除。']);
    const r = await runCli(home, ['forget', '--pending']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /待删清单 1 条/);
    assert.ok(r.stdout.includes(ids[0]!), '清单必须包含记忆 id');
    assert.match(r.stdout, /标注于/);
    assert.match(r.stdout, /已遗忘/);
    const listAt = r.stdout.indexOf('待删清单');
    const resultAt = r.stdout.indexOf('已遗忘');
    assert.ok(listAt >= 0 && resultAt > listAt, '必须先打印清单再执行删除');
    assert.equal(statuses(home)[ids[0]!], 'tombstoned');
  } finally {
    cleanupTestHome(home);
  }
});

test('forget --pending：空清单也是成功（nothing to do）', async () => {
  const home = makeTestHome('cairn-annot-cli-');
  try {
    const svc = AppService.open(home);
    svc.close();
    const r = await runCli(home, ['--json', 'forget', '--pending', '--dry-run']);
    assert.equal(r.code, 0, r.stderr);
    const body = JSON.parse(r.stdout) as { pending: number; items: unknown[] };
    assert.equal(body.pending, 0);
    assert.equal(body.items.length, 0);
  } finally {
    cleanupTestHome(home);
  }
});
