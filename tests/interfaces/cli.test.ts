import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestHome } from '../helpers.js';

/**
 * CLI 合同（任务 5.1）：命令级 JSON 与退出码、机器可读输出、
 * 被治理拒绝返回稳定退出码。全部在合成 HOME 上运行。
 */

const ROOT = join(import.meta.dirname ?? process.cwd(), '..', '..');
const TSX = ['--import', 'tsx', join(ROOT, 'src', 'interfaces', 'cli', 'main.ts')];

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], env?: Record<string, string>): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [...TSX, ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (c) => (stdout += c));
    p.stderr.on('data', (c) => (stderr += c));
    p.on('error', reject);
    p.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('CLI：init → add → search → doctor 机器可读输出与退出码 0', async () => {
  const home = makeTestHome();
  const base = ['--home', home, '--json'];
  const init = await runCli([...base, 'init']);
  assert.equal(init.code, 0, init.stderr);
  const initJson = JSON.parse(init.stdout);
  assert.equal(initJson.initialized, true);
  assert.ok(String(initJson.device).startsWith('dev_'));

  const add = await runCli([...base, 'add', '项目的构建约定是 pnpm', '--kind', 'fact']);
  assert.equal(add.code, 0, add.stderr);
  const addJson = JSON.parse(add.stdout);
  assert.equal(addJson.status, 'active');
  assert.equal(addJson.authority, 'user_explicit');

  const search = await runCli([...base, 'search', '构建约定']);
  assert.equal(search.code, 0);
  const s = JSON.parse(search.stdout);
  assert.equal(s.results.length, 1);
  assert.equal(s.matchedBy, 'fts');

  const doctor = await runCli([...base, 'doctor']);
  assert.equal(doctor.code, 0);
  const d = JSON.parse(doctor.stdout);
  assert.equal(d.ok, true);
  assert.equal(d.remote, 'not_configured');
  assert.equal(d.model, 'not_configured');
  assert.equal(d.db.integrity, 'ok');
});

test('CLI：update 形成新修订；forget 后退出活动导出', async () => {
  const home = makeTestHome();
  const base = ['--home', home, '--json'];
  await runCli([...base, 'add', '初始版本内容']);
  const found = JSON.parse((await runCli([...base, 'search', '初始版本'])).stdout);
  const id = found.results[0]!.memory.id;

  const upd = await runCli([...base, 'update', id, '更正后的内容', '--reason', '用户更正']);
  assert.equal(upd.code, 0, upd.stderr);
  const u = JSON.parse(upd.stdout);
  assert.equal(u.seq, 2);

  const show = await runCli([...base, 'show', id]);
  const sh = JSON.parse(show.stdout);
  assert.equal(sh.revisions.length, 2);
  assert.equal(sh.revisions[0].content, '初始版本内容', '历史不可无痕修改');

  const forget = await runCli([...base, 'forget', id, '--reason', 'test']);
  assert.equal(JSON.parse(forget.stdout).status, 'tombstoned');

  const exp = await runCli([...base, 'export', '--format', 'json']);
  const doc = JSON.parse(exp.stdout);
  assert.equal(doc.memories.length, 0, '被遗忘内容不进活动导出');
  assert.equal(doc.tombstones.length, 1);
  assert.ok(!exp.stdout.includes('更正后的内容'), '导出不含被遗忘正文');
});

test('CLI：秘密内容被拒绝，退出码 3；未知命令退出码 2', async () => {
  const home = makeTestHome();
  const base = ['--home', home, '--json'];
  const secret = await runCli([...base, 'add', 'password = "supersecret99"']);
  assert.equal(secret.code, 3, `期望 refused=3，实际 ${secret.code}，stderr=${secret.stderr}`);
  const body = JSON.parse(secret.stdout);
  assert.equal(body.error.code, 'E_SECRET_DETECTED');
  assert.ok(!secret.stdout.includes('supersecret99'), '输出不回显秘密');

  const bad = await runCli([...base, 'definitely-not-a-command']);
  assert.equal(bad.code, 2);
});

test('CLI：agent plan 零写入 → apply 写入 → uninstall 恢复原字节', async () => {
  const home = makeTestHome();
  const proj = mkdtempSync(join(tmpdir(), 'cairn-proj-'));
  try {
    const base = ['--home', home, '--json'];
    const targetPath = join(proj, 'CLAUDE.md');
    writeFileSync(targetPath, '# 项目说明\n\n用户自己的内容。\n', 'utf8');
    const before = readFileSync(targetPath);

    const plan = await runCli([
      ...base, 'agent', 'plan', '--host', 'claude-code', '--home-root', home, '--project-root', proj, '--mode', 'router',
    ]);
    assert.equal(plan.code, 0, `plan 失败 stderr=${plan.stderr} stdout=${plan.stdout.slice(0, 400)}`);
    const planJson = JSON.parse(plan.stdout);
    assert.ok(planJson.signature.length === 64);
    assert.equal(readFileSync(targetPath).toString(), before.toString(), 'plan 零写入');

    const planFile = join(proj, 'plan.json');
    writeFileSync(planFile, plan.stdout, 'utf8');
    const apply = await runCli([...base, 'agent', 'apply', '--plan-file', planFile]);
    assert.equal(apply.code, 0, `apply 失败 stderr=${apply.stderr} stdout=${apply.stdout.slice(0, 400)}`);
    const after = readFileSync(targetPath).toString();
    assert.ok(after.includes('cairn:begin'), '受管区块已写入');
    assert.ok(after.includes('用户自己的内容'), '原有内容保留');

    const un = await runCli([...base, 'agent', 'uninstall', '--host', 'claude-code', '--home-root', home, '--project-root', proj]);
    assert.equal(un.code, 0, un.stderr);
    assert.deepEqual(readFileSync(targetPath), before, '卸载恢复原字节');
    assert.ok(existsSync(targetPath));
  } finally {
    try {
      const { rmSync } = await import('node:fs');
      rmSync(proj, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* best effort */
    }
  }
});

test('CLI：backup → 继续写入 → restore 到备份时点', async () => {
  const home = makeTestHome();
  const base = ['--home', home, '--json'];
  await runCli([...base, 'add', '备份前事实']);
  const backupDir = mkdtempSync(join(tmpdir(), 'cairn-bak-'));
  const backupPath = join(backupDir, 'b.db');
  try {
    const bp = await runCli([...base, 'backup', '--out', backupPath]);
    assert.equal(bp.code, 0, bp.stderr);
    await runCli([...base, 'add', '备份后事实']);
    const s1 = JSON.parse((await runCli([...base, 'status'])).stdout);
    assert.equal(s1.memories.active, 2);

    const rs = await runCli([...base, 'restore', backupPath, '--home', home]);
    assert.equal(rs.code, 0, rs.stderr);
    const s2 = JSON.parse((await runCli([...base, 'status'])).stdout);
    assert.equal(s2.memories.active, 1, '恢复到备份时点');
  } finally {
    try {
      const { rmSync } = await import('node:fs');
      rmSync(backupDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* best effort */
    }
  }
});
