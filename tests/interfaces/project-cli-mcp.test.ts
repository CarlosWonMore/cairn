import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync, ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { makeTestHome, cleanupTestHome } from '../helpers.js';
import { cliEntry, mcpServerEntry } from '../spawn-target.js';

/**
 * 项目身份入口合同（add-stable-project-identity tasks 3.5 / 4.4）：
 * 同一路径经 CLI 与 MCP 必须得到同一 projectId 与 created 状态；
 * CLI 与 MCP 的 list 共用同一只读实现，均不新增项目行。
 */

const cliTarget = cliEntry();
const mcpTarget = mcpServerEntry();

function runCli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [...cliTarget.loader, cliTarget.file, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (c) => (stdout += c));
    p.stderr.on('data', (c) => (stderr += c));
    p.on('error', reject);
    p.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

interface Probe {
  proc: ChildProcess;
  stdoutText: string;
  stderrText: string;
  send(obj: unknown): void;
  wait(ms: number): Promise<void>;
  kill(): Promise<void>;
}

function startServer(home: string): Probe {
  const p = spawn(process.execPath, [...mcpTarget.loader, mcpTarget.file, '--home', home], { stdio: ['pipe', 'pipe', 'pipe'] });
  const probe: Probe = {
    proc: p,
    stdoutText: '',
    stderrText: '',
    send(obj) {
      p.stdin!.write(JSON.stringify(obj) + '\n');
    },
    wait(ms) {
      return new Promise((r) => setTimeout(r, ms));
    },
    kill() {
      return new Promise((r) => {
        if (p.exitCode !== null || p.signalCode !== null) return r();
        p.once('close', () => r());
        p.kill();
      });
    },
  };
  p.stdout!.on('data', (c) => (probe.stdoutText += String(c)));
  p.stderr!.on('data', (c) => (probe.stderrText += String(c)));
  return probe;
}

async function waitReady(probe: Probe, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (probe.stderrText.includes('stdio server ready')) return;
    if (Date.now() - start > timeoutMs) throw new Error(`MCP 启动超时；stderr=${probe.stderrText.slice(0, 200)}`);
    await probe.wait(20);
  }
}

async function callTool(probe: Probe, id: number, name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  probe.send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
  const start = Date.now();
  for (;;) {
    const line = probe.stdoutText
      .trim()
      .split('\n')
      .filter(Boolean)
      .find((l) => (JSON.parse(l) as { id?: number }).id === id);
    if (line) {
      const res = JSON.parse(line) as { result?: { isError?: boolean; content?: { text: string }[] } };
      assert.equal(res.result?.isError, undefined, `工具 ${name} 返回错误: ${res.result?.content?.[0]?.text}`);
      return JSON.parse(res.result!.content![0]!.text) as Record<string, unknown>;
    }
    if (Date.now() - start > 15000) throw new Error(`等待 ${name} 响应超时；stdout=${probe.stdoutText.slice(0, 400)}`);
    await probe.wait(50);
  }
}

test('CLI 与 MCP：同一路径解析出同一项目，list 均只读', async () => {
  const home = makeTestHome();
  const base = ['--home', home, '--json'];
  const probe = startServer(home);
  try {
    await waitReady(probe);
    probe.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'project-identity-test', version: '0' } } });
    probe.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    await probe.wait(100);

    const cliNew = await runCli([...base, 'project', 'resolve', 'https://github.com/o/r.git', '--name', '仓库 R']);
    assert.equal(cliNew.code, 0, cliNew.stderr);
    const fromCli = JSON.parse(cliNew.stdout) as { projectId: string; name: string; created: boolean; matchedAlias: string };
    assert.equal(fromCli.created, true);
    assert.equal(fromCli.name, '仓库 R');

    const fromMcp = (await callTool(probe, 2, 'project_resolve', { path_or_url: 'git@github.com:o/r.git' })) as unknown as typeof fromCli;
    assert.equal(fromMcp.projectId, fromCli.projectId, 'CLI 与 MCP 必须算出同一个 id');
    assert.equal(fromMcp.created, false, 'MCP 命中 CLI 刚建的项目');
    assert.equal(fromMcp.matchedAlias, fromCli.matchedAlias);

    const cliList1 = JSON.parse((await runCli([...base, 'project', 'list'])).stdout) as { count: number; items: { projectId: string }[] };
    const mcpList = (await callTool(probe, 3, 'project_list')) as unknown as { count: number; items: { projectId: string }[] };
    assert.equal(cliList1.count, 1);
    assert.equal(mcpList.count, 1);
    assert.deepEqual(mcpList.items.map((i) => i.projectId), cliList1.items.map((i) => i.projectId));

    const cliList2 = JSON.parse((await runCli([...base, 'project', 'list'])).stdout) as { count: number };
    assert.equal(cliList2.count, 1, 'list 不得新建项目');
  } finally {
    await probe.kill();
    cleanupTestHome(home);
  }
});

test('CLI project alias add：跨项目冲突退出码 4，且不写入', async () => {
  const home = makeTestHome();
  const base = ['--home', home, '--json'];
  const p1 = JSON.parse((await runCli([...base, 'project', 'resolve', 'https://github.com/o/one.git'])).stdout) as { projectId: string };
  const p2 = JSON.parse((await runCli([...base, 'project', 'resolve', 'https://github.com/o/two.git'])).stdout) as { projectId: string };

  const r = await runCli([...base, 'project', 'alias', 'add', p2.projectId, 'git@github.com:o/one.git']);
  assert.equal(r.code, 4, `期望状态冲突(4)，实得 ${r.code}: ${r.stderr}`);
  const body = JSON.parse(r.stdout) as { error: { code: string; details?: { ownerProjectId?: string } } };
  assert.equal(body.error.code, 'E_CONFLICT_STATE');
  assert.equal(body.error.details?.ownerProjectId, p1.projectId);

  const list = JSON.parse((await runCli([...base, 'project', 'list'])).stdout) as { count: number; items: { aliases: string[] }[] };
  assert.equal(list.count, 2, '被拒绝不得建项目');
  assert.deepEqual(
    list.items.map((i) => i.aliases.length),
    [1, 1],
    '被拒绝不得写入别名',
  );

  // 追加到正确项目则成功，且两项目各自的别名都保留
  const ok = await runCli([...base, 'project', 'alias', 'add', p1.projectId, 'D:/work/one']);
  assert.equal(ok.code, 0, ok.stderr);
  const after = JSON.parse((await runCli([...base, 'project', 'list'])).stdout) as { items: { projectId: string; aliases: string[] }[] };
  assert.deepEqual(after.items.find((i) => i.projectId === p1.projectId)!.aliases, ['https://github.com/o/one', 'D:/work/one']);
  assert.deepEqual(after.items.find((i) => i.projectId === p2.projectId)!.aliases, ['https://github.com/o/two']);
});

/**
 * CLI 读路径的 project 口径（与 MCP 对齐）：UUID 与已登记别名等价；
 * 未登记别名必须报 E_NOT_FOUND 而不是静默 0 命中；缺省仍不可见项目内容。
 */
test('CLI search --project：UUID 与已登记别名同效，未登记别名报错，缺省不可见', async () => {
  const home = makeTestHome();
  const base = ['--home', home, '--json'];
  const alias = 'https://github.com/o/proj.git';
  try {
    const proj = JSON.parse((await runCli([...base, 'project', 'resolve', alias])).stdout) as { projectId: string };
    const added = await runCli([...base, 'add', 'PROJECT_ALPHA_TOKEN rotates monthly', '--scope', 'project-global', '--project', proj.projectId]);
    assert.equal(added.code, 0, added.stderr);

    const byId = JSON.parse((await runCli([...base, 'search', 'PROJECT_ALPHA_TOKEN', '--project', proj.projectId])).stdout) as { results: unknown[] };
    assert.equal(byId.results.length, 1, 'UUID 必须命中项目作用域记忆');

    const byAlias = JSON.parse((await runCli([...base, 'search', 'PROJECT_ALPHA_TOKEN', '--project', alias])).stdout) as { results: unknown[] };
    assert.equal(byAlias.results.length, 1, '已登记别名必须与 UUID 等价（修复前这里 0 命中）');

    const bad = await runCli([...base, 'search', 'PROJECT_ALPHA_TOKEN', '--project', 'D:/never/registered']);
    assert.notEqual(bad.code, 0, '未登记别名不得静默成功');
    const body = JSON.parse(bad.stdout) as { error: { code: string; message: string } };
    assert.equal(body.error.code, 'E_NOT_FOUND');
    assert.match(body.error.message, /project resolve/);

    const noProject = JSON.parse((await runCli([...base, 'search', 'PROJECT_ALPHA_TOKEN'])).stdout) as { results: unknown[] };
    assert.equal(noProject.results.length, 0, '未携带项目身份时项目作用域内容必须不可见');
  } finally {
    cleanupTestHome(home);
  }
});

test('CLI --help 暴露 search/export 的 --project', async () => {
  const r = await runCli(['--help']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /--project <id\|alias>/);
});

/**
 * CLI 写路径与读路径同一口径（同型问题第四次）：`cairn add --project` 也解析别名，
 * 未登记别名报 E_NOT_FOUND 且零写入，UUID 与 --scope-id 路径行为不变。
 */
test('CLI add --project：已登记别名写入 project-global，落库为 UUID', async () => {
  const home = makeTestHome();
  const base = ['--home', home, '--json'];
  const alias = 'https://github.com/o/write-alias.git';
  try {
    const proj = JSON.parse((await runCli([...base, 'project', 'resolve', alias])).stdout) as { projectId: string };
    assert.match(proj.projectId, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/, '登记应产出 uuidv7');

    const added = await runCli([...base, 'add', 'WRITE_ALIAS_TOKEN rotates monthly', '--scope', 'project-global', '--project', alias]);
    assert.equal(added.code, 0, `已登记别名必须可写（修复前 E_VALIDATION）: ${added.stderr}`);
    assert.equal((JSON.parse(added.stdout) as { skipped?: boolean }).skipped, undefined);

    // 落库的 project_id 就是 UUID：按 UUID 检索必须命中，按别名检索等价
    const byId = JSON.parse((await runCli([...base, 'search', 'WRITE_ALIAS_TOKEN', '--project', proj.projectId])).stdout) as { results: unknown[] };
    assert.equal(byId.results.length, 1);
    const byAlias = JSON.parse((await runCli([...base, 'search', 'WRITE_ALIAS_TOKEN', '--project', alias])).stdout) as { results: unknown[] };
    assert.equal(byAlias.results.length, 1);
  } finally {
    cleanupTestHome(home);
  }
});

test('CLI add --project：未登记别名报 E_NOT_FOUND 且零写入', async () => {
  const home = makeTestHome();
  const base = ['--home', home, '--json'];
  try {
    const bad = await runCli([...base, 'add', 'WRITE_UNREGISTERED_TOKEN', '--scope', 'project-global', '--project', 'D:/never/registered']);
    assert.notEqual(bad.code, 0, '未登记别名不得写入');
    const body = JSON.parse(bad.stdout) as { error: { code: string; message: string } };
    assert.equal(body.error.code, 'E_NOT_FOUND');
    assert.match(body.error.message, /project resolve/);

    const none = JSON.parse((await runCli([...base, 'search', 'WRITE_UNREGISTERED_TOKEN'])).stdout) as { results: unknown[] };
    assert.equal(none.results.length, 0, '失败必须零写入');
    const list = JSON.parse((await runCli([...base, 'project', 'list'])).stdout) as { count: number };
    assert.equal(list.count, 0, '写路径只查不建，不得顺手登记项目');
  } finally {
    cleanupTestHome(home);
  }
});

test('CLI add --project：合法 UUID 行为不变（回归）', async () => {
  const home = makeTestHome();
  const base = ['--home', home, '--json'];
  try {
    const proj = JSON.parse((await runCli([...base, 'project', 'resolve', 'https://github.com/o/write-uuid.git'])).stdout) as { projectId: string };
    const added = await runCli([...base, 'add', 'WRITE_UUID_TOKEN', '--scope', 'project-global', '--project', proj.projectId]);
    assert.equal(added.code, 0, added.stderr);
    const hit = JSON.parse((await runCli([...base, 'search', 'WRITE_UUID_TOKEN', '--project', proj.projectId])).stdout) as { results: unknown[] };
    assert.equal(hit.results.length, 1);
  } finally {
    cleanupTestHome(home);
  }
});

test('CLI add --scope-id：不触发 project 解析（回归）', async () => {
  const home = makeTestHome();
  const base = ['--home', home, '--json'];
  try {
    const first = JSON.parse((await runCli([...base, 'add', 'SCOPE_ID_TOKEN', '--scope', 'personal-global'])).stdout) as { scopeId: string };
    assert.ok(first.scopeId);

    // 带一个未登记 --project 也必须成功：--scope-id 已指定作用域，不走解析
    const second = await runCli([...base, 'add', 'SCOPE_ID_TOKEN_2', '--scope-id', first.scopeId, '--project', 'D:/never/registered']);
    assert.equal(second.code, 0, second.stderr);
    assert.equal((JSON.parse(second.stdout) as { scopeId: string }).scopeId, first.scopeId);
  } finally {
    cleanupTestHome(home);
  }
});

/** 候选只能由 MCP 创建（CLI 无 propose），沿用 cli.test.ts 的做法：add 后直接降级 status。 */
async function addCandidate(home: string, content: string): Promise<string> {
  const added = JSON.parse((await runCli(['--home', home, '--json', 'add', content])).stdout) as { id: string };
  execFileSync(process.execPath, ['-e', `
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(${JSON.stringify(join(home, 'data', 'cairn.db'))});
    db.prepare("UPDATE memory SET status='candidate', authority='agent_inferred', confidence=0.5 WHERE id=?").run(${JSON.stringify(added.id)});
    db.close();
  `], { encoding: 'utf8' });
  return added.id;
}

/**
 * 写路径的 `--scope-project` 也必须解析别名（同型问题第五次）：promote 与两个 rescope 分支
 * 原先原样透传，已登记别名一律撞 resolveScope 的「项目身份必须是 UUID」（E_VALIDATION）。
 */
test('CLI rescope <id> --scope-project：已登记别名迁移到该项目作用域', async () => {
  const home = makeTestHome();
  const base = ['--home', home, '--json'];
  const alias = 'https://github.com/o/rescope-alias.git';
  try {
    const proj = JSON.parse((await runCli([...base, 'project', 'resolve', alias])).stdout) as { projectId: string };
    const added = JSON.parse((await runCli([...base, 'add', 'RESCOPE_ALIAS_TOKEN stays project-scoped'])).stdout) as { id: string; scopeId: string };

    const r = await runCli([...base, 'rescope', added.id, '--scope-preset', 'project-global', '--scope-project', alias, '--force']);
    assert.equal(r.code, 0, `已登记别名必须可迁移（修复前 E_VALIDATION）: ${r.stderr}`);
    const body = JSON.parse(r.stdout) as { targetScope: string; results: { ok: boolean; toScope?: string }[] };
    assert.equal(body.results[0]?.ok, true);
    assert.equal(body.results[0]?.toScope, body.targetScope, '落点必须是项目作用域');
    assert.notEqual(body.targetScope, added.scopeId);

    // 落点是该项目 UUID 的作用域：按 UUID 与按别名检索都必须命中
    for (const project of [proj.projectId, alias]) {
      const hit = JSON.parse((await runCli([...base, 'search', 'RESCOPE_ALIAS_TOKEN', '--project', project])).stdout) as { results: unknown[] };
      assert.equal(hit.results.length, 1, `按 ${project} 必须命中迁移后的记忆`);
    }
  } finally {
    cleanupTestHome(home);
  }
});

test('CLI rescope <id> --scope-project：未登记别名报 E_NOT_FOUND 且作用域未变', async () => {
  const home = makeTestHome();
  const base = ['--home', home, '--json'];
  try {
    const added = JSON.parse((await runCli([...base, 'add', 'RESCOPE_BAD_ALIAS_TOKEN untouched'])).stdout) as { id: string };
    const bad = await runCli([...base, 'rescope', added.id, '--scope-preset', 'project-global', '--scope-project', 'D:/never/registered', '--force']);
    assert.notEqual(bad.code, 0, '未登记别名不得迁移');
    const body = JSON.parse(bad.stdout) as { error: { code: string; message: string } };
    assert.equal(body.error.code, 'E_NOT_FOUND');
    assert.match(body.error.message, /project resolve/);

    // 作用域未变：默认检索（非项目作用域）仍命中；项目作用域不可见
    const plain = JSON.parse((await runCli([...base, 'search', 'RESCOPE_BAD_ALIAS_TOKEN'])).stdout) as { results: unknown[] };
    assert.equal(plain.results.length, 1, '失败必须零写入');
    const list = JSON.parse((await runCli([...base, 'project', 'list'])).stdout) as { count: number };
    assert.equal(list.count, 0, '写路径只查不建');
  } finally {
    cleanupTestHome(home);
  }
});

test('CLI promote --scope-project：已登记别名晋升到该项目作用域', async () => {
  const home = makeTestHome();
  const base = ['--home', home, '--json'];
  const alias = 'https://github.com/o/promote-alias.git';
  try {
    const proj = JSON.parse((await runCli([...base, 'project', 'resolve', alias])).stdout) as { projectId: string };
    const candId = await addCandidate(home, 'PROMOTE_ALIAS_TOKEN candidate');

    const r = await runCli([...base, 'promote', candId, '--scope-preset', 'project-global', '--scope-project', alias]);
    assert.equal(r.code, 0, `已登记别名必须可晋升（修复前 E_VALIDATION）: ${r.stderr}`);
    const body = JSON.parse(r.stdout) as { status: string; scopePreset: string; scopeId: string; previousScopeId: string };
    assert.equal(body.status, 'active');
    assert.equal(body.scopePreset, 'project-global');
    assert.notEqual(body.scopeId, body.previousScopeId);

    const hit = JSON.parse((await runCli([...base, 'search', 'PROMOTE_ALIAS_TOKEN', '--project', proj.projectId])).stdout) as { results: unknown[] };
    assert.equal(hit.results.length, 1);
  } finally {
    cleanupTestHome(home);
  }
});

test('CLI promote / rescope：--scope-project 传合法 UUID 行为不变（回归）', async () => {
  const home = makeTestHome();
  const base = ['--home', home, '--json'];
  try {
    const proj = JSON.parse((await runCli([...base, 'project', 'resolve', 'https://github.com/o/uuid-write.git'])).stdout) as { projectId: string };

    const candId = await addCandidate(home, 'UUID_WRITE_PROMOTE_TOKEN');
    const promoted = await runCli([...base, 'promote', candId, '--scope-preset', 'project-global', '--scope-project', proj.projectId]);
    assert.equal(promoted.code, 0, promoted.stderr);
    assert.equal((JSON.parse(promoted.stdout) as { scopePreset: string }).scopePreset, 'project-global');

    const added = JSON.parse((await runCli([...base, 'add', 'UUID_WRITE_RESCOPE_TOKEN'])).stdout) as { id: string };
    const rescoped = await runCli([...base, 'rescope', added.id, '--scope-preset', 'project-global', '--scope-project', proj.projectId, '--force']);
    assert.equal(rescoped.code, 0, rescoped.stderr);

    // --pending 分支同样接受 UUID（空清单也算跑通解析路径）
    const pending = await runCli([...base, 'rescope', '--pending', '--scope-preset', 'project-global', '--scope-project', proj.projectId]);
    assert.equal(pending.code, 0, pending.stderr);
  } finally {
    cleanupTestHome(home);
  }
});
