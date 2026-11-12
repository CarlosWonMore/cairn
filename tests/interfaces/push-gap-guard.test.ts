import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestHome, cleanupTestHome } from '../helpers.js';

/**
 * push 前的上行缺口提示（OpenSpec: add-push-gap-guard）。
 * 钉住：有缺口时 stderr 警告 + stdout 保持纯 JSON + 退出码 0 + 不入队；
 * 无缺口时完全静默；doctor / backfill / push 三处条数同源。
 * 远端是本地 syncd 子进程，不触外网。
 */

const { cliEntry } = await import('../spawn-target.js');
const target = cliEntry();
const TSX = [...target.loader, target.file];

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runCli(home: string, args: string[], env?: Record<string, string>): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [...TSX, '--home', home, ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (c) => (stdout += String(c)));
    p.stderr.on('data', (c) => (stderr += String(c)));
    p.on('error', reject);
    p.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function startSyncd(): Promise<{ baseUrl: string; token: string; stop(): Promise<void> }> {
  const dataDir = mkdtempSync(join(tmpdir(), 'syncd-gap-data-'));
  const token = `tok_${Math.random().toString(36).slice(2)}`;
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [join(process.cwd(), 'syncd', 'cairn-syncd.mjs')], {
    env: { ...process.env, CAIRN_SYNCD_PORT: String(port), CAIRN_SYNCD_HOST: '127.0.0.1', CAIRN_SYNCD_TOKEN: token, CAIRN_SYNCD_DATA: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout!.on('data', (c) => (out += String(c)));
  child.stderr!.on('data', (c) => (out += String(c)));
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 10000;
  for (;;) {
    if (out.includes('listening on')) break;
    if (Date.now() > deadline) throw new Error(`syncd 启动超时: ${out}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  return {
    baseUrl,
    token,
    stop: () =>
      new Promise<void>((r) => {
        child.on('close', () => {
          try {
            rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
          } catch {
            /* best effort */
          }
          r();
        });
        child.kill();
      }),
  };
}

/** 造历史遗留缺口的形状：删掉某条记忆的 outbox 任务（add 正常会入队）。 */
function dropJobs(home: string, memoryId: string): void {
  execFileSync(process.execPath, ['-e', `
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(${JSON.stringify(join(home, 'data', 'cairn.db'))});
    db.prepare("DELETE FROM outbox_job WHERE entity_id = ?").run(${JSON.stringify(memoryId)});
    db.close();
  `], { encoding: 'utf8' });
}

/** 一次 init + add 若干条，再按需挖掉部分入队任务。返回记忆 id 列表。 */
async function seed(home: string, contents: string[], gapIndexes: number[] = []): Promise<string[]> {
  assert.equal((await runCli(home, ['--json', 'init'])).code, 0);
  const ids: string[] = [];
  for (const c of contents) {
    const r = await runCli(home, ['--json', 'add', c]);
    assert.equal(r.code, 0, r.stderr);
    ids.push(JSON.parse(r.stdout).id as string);
  }
  for (const i of gapIndexes) dropJobs(home, ids[i]!);
  return ids;
}

async function configureVault(home: string, baseUrl: string): Promise<void> {
  const r = await runCli(home, ['--json', 'vault', 'init-remote', '--provider', 'syncd', '--base-url', baseUrl]);
  assert.equal(r.code, 0, r.stderr);
}

function backfillCandidates(home: string): Promise<number> {
  return runCli(home, ['--json', 'sync', 'backfill']).then((r) => {
    assert.equal(r.code, 0, r.stderr);
    return JSON.parse(r.stdout).candidates as number;
  });
}

test('2.1/2.3 有缺口：stderr 警告 + stdout 纯 JSON + 推送照常成功 + 不入队', async () => {
  const syncd = await startSyncd();
  const home = makeTestHome('cairn-pushgap-');
  try {
    const [, gapId] = await seed(home, ['正常待上行的记忆', '历史上没入队的记忆'], [1]);
    await configureVault(home, syncd.baseUrl);
    assert.equal(await backfillCandidates(home), 1, '前置：1 条缺口');

    const r = await runCli(home, ['--json', 'sync', 'push'], { CAIRN_SYNCD_TOKEN: syncd.token });

    assert.equal(r.code, 0, r.stderr);
    const body = JSON.parse(r.stdout) as { publishedChunks: unknown[] };
    assert.ok(body.publishedChunks.length > 0, '推送照常执行（1 条待办真的发出去了）');

    assert.match(r.stderr, /上行缺口 1 条/, 'stderr 报告条数');
    assert.ok(r.stderr.includes('这些记忆尚未入队，本次推送不包含它们'), '文案不得让人以为已补');
    assert.ok(r.stderr.includes('cairn sync backfill --apply'), '指向补缺口命令');

    // 2.3 提示不改变任务：缺口记忆没被偷偷入队，仍只有那 1 条缺口
    assert.equal(await backfillCandidates(home), 1, '提示不得写 outbox');
    const after = await runCli(home, ['--json', 'sync', 'backfill']);
    assert.deepEqual(JSON.parse(after.stdout).memoryIds, [gapId], '缺口仍是同一条');
  } finally {
    await syncd.stop();
    cleanupTestHome(home);
  }
});

test('2.2 无缺口：push 输出中不出现任何缺口相关内容', async () => {
  const syncd = await startSyncd();
  const home = makeTestHome('cairn-pushgap-');
  try {
    await seed(home, ['全部已入队的记忆一', '全部已入队的记忆二']);
    await configureVault(home, syncd.baseUrl);

    const r = await runCli(home, ['--json', 'sync', 'push'], { CAIRN_SYNCD_TOKEN: syncd.token });

    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stderr.includes('缺口'), false, `健康时不得有缺口噪音，实际 stderr=${r.stderr}`);
    assert.equal(r.stderr.includes('backfill'), false, '健康时不得指向 backfill');
    assert.ok((JSON.parse(r.stdout) as { publishedChunks: unknown[] }).publishedChunks.length > 0);
  } finally {
    await syncd.stop();
    cleanupTestHome(home);
  }
});

test('2.4 三处口径一致：doctor / backfill 只读 / sync push 报同一数字', async () => {
  const syncd = await startSyncd();
  const home = makeTestHome('cairn-pushgap-');
  try {
    await seed(home, ['已入队的记忆', '缺口记忆甲', '缺口记忆乙'], [1, 2]);
    await configureVault(home, syncd.baseUrl);

    const doctor = await runCli(home, ['--json', 'doctor']);
    assert.equal(doctor.code, 0, doctor.stderr);
    const doctorGap = (JSON.parse(doctor.stdout) as { counts: { upstreamGap: number } }).counts.upstreamGap;

    const candidates = await backfillCandidates(home);

    const push = await runCli(home, ['--json', 'sync', 'push'], { CAIRN_SYNCD_TOKEN: syncd.token });
    assert.equal(push.code, 0, push.stderr);
    const warned = /上行缺口 (\d+) 条/.exec(push.stderr);
    assert.ok(warned, `push 应报缺口，实际 stderr=${push.stderr}`);

    assert.equal(doctorGap, 2);
    assert.equal(candidates, doctorGap, 'backfill 与 doctor 同源');
    assert.equal(Number(warned[1]), doctorGap, 'push 与 doctor 同源');
  } finally {
    await syncd.stop();
    cleanupTestHome(home);
  }
});
