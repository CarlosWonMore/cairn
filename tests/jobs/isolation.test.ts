import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openStore } from '../../src/store/open.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';
import type { RunOnceSummary } from '../../src/jobs/worker.js';

/**
 * 隔离合同证明（agent-interfaces spec「后台任务退出会话关键路径」）：
 * 在真实独立进程里跑 runOnce，所有 handler 都失败（extract 无模型），
 * 子进程仍必须 exit 0、summary 可解析——「Agent 会话不被后台故障终止」的最小证明。
 * 父进程不采信子进程自述：summary 解析后还要独立重开磁盘库核对任务状态。
 */

function spawnChild(home: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
  const fixture = fileURLToPath(new URL('./fixtures/worker-child.mts', import.meta.url));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', fixture], {
      cwd: projectRoot,
      env: { ...process.env, CAIRN_TEST_HOME: home },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

test('隔离合同：子进程 runOnce 全部失败仍 exit 0，任务状态落盘为 retry', async () => {
  const home = makeTestHome('cairn-worker-child-');
  try {
    const res = await spawnChild(home);
    assert.equal(res.code, 0, `子进程必须正常退出 0（后台故障不得终止进程）。stderr 尾部: ${res.stderr.slice(-400)}`);

    // stdout 只有一行 summary JSON（node:sqlite 的 ExperimentalWarning 走 stderr）
    const lines = res.stdout.trim().split(/\r?\n/).filter(Boolean);
    assert.equal(lines.length, 1, `stdout 应只有 summary 一行，实际: ${JSON.stringify(res.stdout)}`);
    const summary = JSON.parse(lines[0]!) as RunOnceSummary;
    assert.equal(summary.processed, 1);
    assert.equal(summary.done, 0);
    assert.equal(summary.retry, 1);
    assert.equal(summary.dead, 0);
    assert.equal(summary.failures.length, 1);
    assert.equal(summary.failures[0]!.error, 'extract_requires_model_config');

    // 独立复跑核对磁盘产物：不采信子进程打印的 summary
    const store = openStore({ home });
    try {
      const jobs = store.outbox.list({ jobType: 'extract' });
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0]!.status, 'retry');
      assert.equal(jobs[0]!.lastError, 'extract_requires_model_config');
      assert.equal(store.outbox.counts().retry, 1);
    } finally {
      store.close();
    }
  } finally {
    cleanupTestHome(home);
  }
});
