import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestHome } from '../helpers.js';

/**
 * CLI 合同（任务 5.1）：命令级 JSON 与退出码、机器可读输出、
 * 被治理拒绝返回稳定退出码。全部在合成 HOME 上运行。
 */

const { cliEntry } = await import('../spawn-target.js');
const target = cliEntry();
const TSX = [...target.loader, target.file];

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

test('CLI：audit list 只读可查，检索留痕且零内容泄露', async () => {
  const home = makeTestHome();
  const base = ['--home', home, '--json'];
  await runCli([...base, 'add', '操作审计合同测试记忆-7712']);
  await runCli([...base, 'search', '审计合同测试']);
  const r = await runCli([...base, 'audit', 'list', '--category', 'operation']);
  assert.equal(r.code, 0, r.stderr);
  const body = JSON.parse(r.stdout) as { items: { category: string; action: string; detail: Record<string, unknown> }[]; count: number };
  assert.ok(body.items.some((i) => i.action === 'memory_search'), 'search 留了 operation 事件');
  assert.ok(body.items.every((i) => i.category === 'operation'), 'category 过滤生效');
  // 摘要纪律：审计输出不含查询原文与记忆正文
  assert.ok(!r.stdout.includes('审计合同测试'), '查询原文不得入审计输出');
  assert.ok(!r.stdout.includes('操作审计合同测试记忆-7712'), '记忆正文不得入审计输出');
  // 过滤参数合同：action 无匹配返回空
  const empty = JSON.parse((await runCli([...base, 'audit', 'list', '--action', 'no_such_action'])).stdout) as { count: number };
  assert.equal(empty.count, 0);
});

/**
 * 候选晋升 / 拒绝的 CLI 合同（add-candidate-promote-command）。
 *
 * 锁死：JSON 形状、四个退出码档位、非交互可跑。
 */
test('promote / reject：命令合同与退出码', async () => {
  // 候选只能由 MCP 的 memory_propose 创建（CLI 无 propose 子命令），
  // 这里先用 CLI add 造一条 active，再用 node 把它降级成候选写回同一个库。
  const home = makeTestHome();
  const base = ['--home', home, '--json'];
  assert.equal((await runCli([...base, 'init'])).code, 0);

  const toCandidate = (content: string): string => {
    const added = JSON.parse(execFileSync(process.execPath, [
      ...TSX, ...base, 'add', content, '--kind', 'fact',
    ], { encoding: 'utf8' })).id as string;
    const dbPath = join(home, 'data', 'cairn.db');
    execFileSync(process.execPath, ['-e', `
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(${JSON.stringify(dbPath)});
      db.prepare("UPDATE memory SET status='candidate', authority='agent_inferred', confidence=0.5 WHERE id=?").run(${JSON.stringify(added)});
      db.close();
    `], { encoding: 'utf8' });
    return added;
  };

  // 不存在的 id → 稳定非零（E_NOT_FOUND 映射到 failure=1，见 EXIT_BY_CODE 既有约定）
  const missing = await runCli([...base, 'promote', '01a18002-0000-7000-8000-000000000000']);
  assert.equal(missing.code, 1, `期望未找到(1)，实得 ${missing.code}: ${missing.stderr}`);

  // 晋升候选 → 成功，权威 user_confirmed
  const candId = toCandidate('候选内容：投影排序要按重要度');
  const ok = await runCli([...base, 'promote', candId]);
  assert.equal(ok.code, 0, ok.stderr);
  const promoted = JSON.parse(ok.stdout);
  assert.equal(promoted.status, 'active');
  assert.equal(promoted.authority, 'user_confirmed');
  assert.equal(promoted.id, candId);

  // 再晋升一次 → 状态冲突档
  const again = await runCli([...base, 'promote', candId]);
  assert.equal(again.code, 4, `期望状态冲突(4)，实得 ${again.code}`);

  // 拒绝非候选 → 状态冲突档
  const rejBad = await runCli([...base, 'reject', candId, '已经不候选了']);
  assert.equal(rejBad.code, 4);

  // 新候选 + 拒绝 → 墓碑
  const cand2 = toCandidate('第二条候选：会被拒绝');
  const rej = await runCli([...base, 'reject', cand2, '内容不成立']);
  assert.equal(rej.code, 0, rej.stderr);
  assert.equal(JSON.parse(rej.stdout).status, 'tombstoned');

  // 缺理由 → 用法错误档
  const cand3 = toCandidate('第三条候选');
  const noReason = await runCli([...base, 'reject', cand3]);
  assert.equal(noReason.code, 2, `期望用法错误(2)，实得 ${noReason.code}`);
});

test('promote --scope-preset 真的迁移作用域（2026-11-04 flag 未登记白名单的回归）', async () => {
  // 曾经的 bug：scope-preset 不在 VALUE_FLAGS 里，parseArgs 把它当布尔 true，
  // str() 返回 undefined —— promote 成功但作用域没变，且终端看起来一切正常。
  const home = makeTestHome();
  const base = ['--home', home, '--json'];
  assert.equal((await runCli([...base, 'init'])).code, 0);

  const added = JSON.parse(execFileSync(process.execPath, [
    ...TSX, ...base, 'add', '带本机路径的记忆应当落 device-local', '--kind', 'fact',
  ], { encoding: 'utf8' })).id as string;
  const dbPath = join(home, 'data', 'cairn.db');
  execFileSync(process.execPath, ['-e', `
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(${JSON.stringify(dbPath)});
    db.prepare("UPDATE memory SET status='candidate', authority='agent_inferred', confidence=0.5 WHERE id=?").run(${JSON.stringify(added)});
    db.close();
  `], { encoding: 'utf8' });

  const promoted = JSON.parse((await runCli([...base, 'promote', added, '--scope-preset', 'device-local'])).stdout);
  assert.equal(promoted.scopePreset, 'device-local', 'scopePreset 必须是 device-local');
  assert.notEqual(promoted.scopeId, promoted.previousScopeId, 'scopeId 必须真的变了');
});
