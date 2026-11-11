import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'node:child_process';
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
