import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestHome, cleanupTestHome } from '../helpers.js';

/**
 * 端到端集成验收（任务 8.1 / 8.2）：
 * 发现→勾选→快照→档案检索→Agent 计划→独立审批→应用→投影→卸载 全链路；
 * 三次独立授权不可捆绑；双 MCP 客户端 + CLI 跨进程共用同一本地库。
 */

import { cliEntry, mcpServerEntry } from '../spawn-target.js';
const cliTarget = cliEntry();
const serverTarget = mcpServerEntry();

function runCli(args: string[], env?: Record<string, string>): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [...cliTarget.loader, cliTarget.file, ...args], {
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

function rmdir(p: string): void {
  try {
    rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    /* best effort */
  }
}

test('E2E 全链路：发现→导入→计划→审批→应用→投影→卸载（三次授权互相独立）', async () => {
  const home = makeTestHome();
  const fakeUserHome = mkdtempSync(join(tmpdir(), 'cairn-userhome-'));
  const proj = mkdtempSync(join(tmpdir(), 'cairn-e2e-proj-'));
  try {
    const base = ['--home', home, '--json'];
    const claudeHome = join(fakeUserHome, '.claude', 'projects', 'demo', 'memory');
    mkdirSync(claudeHome, { recursive: true });
    writeFileSync(join(claudeHome, 'MEMORY.md'), '## 用户偏好\n\n偏好使用 pnpm 管理依赖\n\n## 项目决策\n\n部署端口是 9090\n', 'utf8');

    // 1. 发现：零正文（金丝雀只出现在 fixture 正文，不出现在结果）
    const discover = await runCli([...base, 'discover', '--home-dir', fakeUserHome]);
    assert.equal(discover.code, 0, discover.stderr);
    assert.ok(!discover.stdout.includes('pnpm'), '发现阶段不读正文');
    const sources = JSON.parse(discover.stdout);
    assert.ok(sources.length >= 1, '发现到 Claude Code 记忆来源');

    // 2. 导入授权（第一次独立授权）：只建档案，不写任何宿主配置
    const importedFile = join(claudeHome, 'MEMORY.md');
    const imp = await runCli([...base, 'import', importedFile, '--agent-kind', 'claude-code']);
    assert.equal(imp.code, 0, imp.stderr);
    const impJson = JSON.parse(imp.stdout);
    const batchId = impJson.batchId as string;
    assert.equal(impJson.imported[0].created, true);
    assert.ok(!existsSync(join(proj, 'CLAUDE.md')), '导入授权不写宿主配置');
    // 源文件哈希不变
    assert.equal(impJson.imported[0].sourceHashBefore, impJson.imported[0].sourceHashAfter);

    // 3. 档案立即可检索（无模型），且未验证状态清晰
    const archSearch = await runCli([...base, 'search', '部署端口']);
    assert.equal(archSearch.code, 0);
    assert.equal(JSON.parse(archSearch.stdout).results.length, 0, '未晋升条目不进活动检索');

    // 4. 分批
    const next = await runCli([...base, 'onboarding', 'next', '--batch', batchId]);
    assert.equal(next.code, 0, next.stderr);
    const chunk = JSON.parse(next.stdout).items;
    assert.ok(chunk.length >= 2);

    // 5. Agent 生成建议 → 计划（第二次独立授权的准备：计划只存不晋升）
    const itemsFile = join(proj, 'items.json');
    writeFileSync(
      itemsFile,
      JSON.stringify(
        chunk.map((c: { content: string; itemId: string }) => ({
          itemId: c.itemId,
          content: c.content,
          kind: 'fact',
          opHint: 'add',
          reason: 'e2e 初始化',
        })),
      ),
      'utf8',
    );
    const planCreate = await runCli([...base, 'plan', 'create', '--items-file', itemsFile, '--batch', batchId]);
    assert.equal(planCreate.code, 0, planCreate.stderr);
    const plan = JSON.parse(planCreate.stdout);
    const planId = plan.plan.id as string;
    assert.equal(plan.plan.status, 'awaiting_approval');

    // 6. 无审批直接应用 → 拒绝（退出码 3）
    const noApproval = await runCli([...base, 'apply', planId, '--approval', 'apr_fake']);
    assert.equal(noApproval.code, 3, noApproval.stderr);

    // 7. 独立审批（第三次独立授权）→ 应用
    const approve = await runCli([...base, 'approve', planId]);
    assert.equal(approve.code, 0, approve.stderr);
    const approvalId = JSON.parse(approve.stdout).approvalId as string;

    const apply = await runCli([...base, 'apply', planId, '--approval', approvalId]);
    assert.equal(apply.code, 0, apply.stderr);
    const applyReport = JSON.parse(apply.stdout);
    assert.ok(applyReport.report.applied >= 2, `应晋升至少 2 条，实际 ${JSON.stringify(applyReport.report)}`);

    // 8. 晋升后可检索
    const search2 = await runCli([...base, 'search', '部署端口']);
    assert.equal(JSON.parse(search2.stdout).results.length, 1);

    // 9. 审批一次性：重放 → 拒绝
    const replay = await runCli([...base, 'apply', planId, '--approval', approvalId]);
    assert.ok(replay.code === 3 || replay.code === 0, '重放要么拒绝要么幂等 alreadyApplied');
    if (replay.code === 0) {
      assert.equal(JSON.parse(replay.stdout).report.alreadyApplied, true);
    }

    // 10. 投影（受管区块，宿主配置第三次授权走 agent plan/apply）
    const claudeMd = join(proj, 'CLAUDE.md');
    writeFileSync(claudeMd, '# 我的工程约定\n\n用户原有内容。\n', 'utf8');
    const before = readFileSync(claudeMd);
    const planOut = await runCli([...base, 'agent', 'plan', '--host', 'claude-code', '--home-root', fakeUserHome, '--project-root', proj, '--mode', 'router']);
    assert.equal(planOut.code, 0, planOut.stderr);
    const planFile = join(proj, 'agent-plan.json');
    writeFileSync(planFile, planOut.stdout, 'utf8');
    const applyCfg = await runCli([...base, 'agent', 'apply', '--plan-file', planFile]);
    assert.equal(applyCfg.code, 0, applyCfg.stderr);
    const after = readFileSync(claudeMd, 'utf8');
    assert.ok(after.includes('cairn:begin') && after.includes('用户原有内容'));

    // 11. 卸载恢复原字节
    const un = await runCli([...base, 'agent', 'uninstall', '--host', 'claude-code', '--home-root', fakeUserHome, '--project-root', proj]);
    assert.equal(un.code, 0, un.stderr);
    assert.deepEqual(readFileSync(claudeMd), before, '卸载恢复原字节');
  } finally {
    cleanupTestHome(home);
    rmdir(fakeUserHome);
    rmdir(proj);
  }
});

test('E2E 双客户端：两个 MCP 进程 + CLI 共用同一本地库，断开后其余继续可用', async () => {
  const home = makeTestHome();
    const start = (agentId: string) => {
    const p = spawn(process.execPath, [...serverTarget.loader, serverTarget.file, '--home', home], {
      env: { ...process.env, CAIRN_AGENT_ID: agentId },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    p.stdout!.on('data', (c) => (out += String(c)));
    p.stderr!.on('data', () => {});
    return {
      p,
      send: (o: unknown) => p.stdin!.write(JSON.stringify(o) + '\n'),
      out: () => out,
      wait: (ms: number) => new Promise((r) => setTimeout(r, ms)),
      stop: () => new Promise<void>((r) => {
        if (p.exitCode !== null || p.signalCode !== null) { r(); return; }
        p.once('close', () => r());
        p.kill();
      }),
    };
  };
  const a = start('agent-a');
  const b = start('agent-b');
  const cli = (args: string[]) => runCli(['--home', home, '--json', ...args]);
  const resp = (text: string, id: number) => {
    const line = text.trim().split('\n').map((l) => String(l)).find((l) => (JSON.parse(l) as { id?: number }).id === id);
    return line ? (JSON.parse(line) as { result?: { content?: { text: string }[] } }) : null;
  };
  try {
    for (const c of [a, b]) {
      c.send({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
      c.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    }
    await a.wait(600);
    // 客户端 A 写入
    a.send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'memory_add', arguments: { content: '跨客户端共享的事实甲' } } });
    // 客户端 B 写入
    b.send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'memory_add', arguments: { content: '跨客户端共享的事实乙' } } });
    await a.wait(800);
    assert.ok(resp(a.out(), 1)?.result?.content?.[0]?.text, 'A 写入成功');
    assert.ok(resp(b.out(), 1)?.result?.content?.[0]?.text, 'B 写入成功（同一本地库）');

    // B 检索到 A 写入的记忆
    b.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'memory_search', arguments: { query: '事实甲' } } });
    await b.wait(500);
    assert.ok(JSON.stringify(resp(b.out(), 2)).includes('事实甲'), 'B 能读到 A 的记忆');

    // CLI 也可见
    const s = JSON.parse((await cli(['search', '跨客户端'])).stdout);
    assert.equal(s.results.length, 2, 'CLI 看到两个客户端的写入');

    // A 断开 → B 与 CLI 继续可用
    await a.stop();
    b.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'memory_status', arguments: {} } });
    await b.wait(500);
    assert.ok(resp(b.out(), 3), 'B 在 A 断开后继续可用');
    const add2 = await cli(['add', 'A 断开后 CLI 仍可写入']);
    assert.equal(add2.code, 0, add2.stderr);
  } finally {
    await a.stop().catch(() => {});
    await b.stop().catch(() => {});
    cleanupTestHome(home);
  }
});

test('E2E worker 故障注入：后台任务失败不影响 CLI 会话，任务留可重试状态', async () => {
  const home = makeTestHome();
  const base = ['--home', home, '--json'];
  try {
    // personal-global 是 encrypted → 会生成 sync_upstream 任务
    const add = await runCli([...base, 'add', '需要上行的事实']);
    assert.equal(add.code, 0, add.stderr);
    const status1 = JSON.parse((await runCli([...base, 'status'])).stdout);
    assert.ok((status1.outbox.pending ?? 0) >= 1, '已生成上行任务');

    // worker run-once 处理（远端未配置 → 任务进 retry，CLI 正常退出 0）
    const w = await runCli([...base, 'worker', 'run-once']);
    assert.equal(w.code, 0, `worker 失败不应影响会话: ${w.stderr}`);
    const summary = JSON.parse(w.stdout);
    assert.equal(summary.processed, 1);
    const status2 = JSON.parse((await runCli([...base, 'status'])).stdout);
    assert.ok((status2.outbox.retry ?? 0) >= 1, '任务留可重试状态');
    // 本地数据不受影响
    const search = await runCli([...base, 'search', '需要上行']);
    assert.equal(JSON.parse(search.stdout).results.length, 1);
  } finally {
    cleanupTestHome(home);
  }
});
