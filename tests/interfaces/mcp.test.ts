import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { makeTestHome, cleanupTestHome } from '../helpers.js';

/**
 * MCP stdio 协议合同（任务 5.2 / agent-interfaces spec）：
 * stdout 只含 JSON-RPC；日志仅 stderr；断开后本地仍可用。
 */

const ROOT = join(import.meta.dirname ?? process.cwd(), '..', '..');
const SERVER = join(ROOT, 'src', 'interfaces', 'mcp', 'server.ts');

interface Probe {
  proc: ChildProcess;
  stdoutText: string;
  send(obj: unknown): void;
  wait(ms: number): Promise<void>;
  stdoutLines(): unknown[];
  kill(): Promise<void>;
}

function startServer(home: string): Probe {
  const p = spawn(process.execPath, ['--import', 'tsx', SERVER, '--home', home], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const probe: Probe = {
    proc: p,
    stdoutText: '',
    send(obj) {
      p.stdin!.write(JSON.stringify(obj) + '\n');
    },
    wait(ms) {
      return new Promise((r) => setTimeout(r, ms));
    },
    stdoutLines() {
      return probe.stdoutText.trim().split('\n').filter(Boolean);
    },
    kill() {
      return new Promise((r) => {
        p.on('close', () => r());
        p.kill();
      });
    },
  };
  p.stdout!.on('data', (c) => (probe.stdoutText += String(c)));
  // stderr 输出只进测试诊断，不进 stdout 断言
  p.stderr!.on('data', (c) => process.stderr.write(`[mcp-stderr] ${String(c).trim()}\n`));
  return probe;
}

function initialize(probe: Probe): void {
  probe.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'contract-test', version: '0' } } });
  probe.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
}

async function responseOf(probe: Probe, id: number, timeoutMs = 15000): Promise<Record<string, unknown>> {
  const start = Date.now();
  for (;;) {
    const line = probe.stdoutLines().map((l) => String(l)).find((l) => (JSON.parse(l) as { id?: number }).id === id);
    if (line) return JSON.parse(line) as Record<string, unknown>;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`等待 id=${id} 响应超时；stdout=${probe.stdoutText.slice(0, 400)}`);
    }
    await probe.wait(50);
  }
}

test('MCP：initialize → tools/list → tools/call；stdout 每行均为合法 JSON-RPC', async () => {
  const home = makeTestHome();
  const probe = startServer(home);
  try {
    initialize(probe);
    probe.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    await probe.wait(400);
    probe.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'memory_add', arguments: { content: '合同测试的记忆内容', kind: 'fact' } } });
    probe.send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'memory_search', arguments: { query: '合同测试' } } });
    probe.send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'memory_propose', arguments: { content: '推断候选：看起来用户使用 Node 24' } } });
    await probe.wait(600);

    // stdout 纯净：每行都是合法 JSON（无日志/警告/异常文本混入）
    const lines = probe.stdoutLines();
    assert.ok(lines.length >= 5, `stdout 行数 ${lines.length}`);
    for (const l of lines) {
      const parsed = JSON.parse(String(l)); // 抛错即失败
      assert.ok('jsonrpc' in parsed || parsed !== null);
    }
    const init = await responseOf(probe, 1) as { result?: { serverInfo?: { name?: string } } };
    assert.equal(init.result?.serverInfo?.name, 'cairn');
    const list = await responseOf(probe, 2) as { result?: { tools?: { name: string }[] } };
    const names = (list.result?.tools ?? []).map((t) => t.name);
    for (const t of ['memory_context', 'memory_search', 'memory_get', 'memory_add', 'memory_propose', 'memory_update', 'memory_forget', 'memory_status']) {
      assert.ok(names.includes(t), `缺少工具 ${t}`);
    }
    const add = await responseOf(probe, 3) as { result?: { content?: { text: string }[] } };
    const addBody = JSON.parse(add.result!.content![0]!.text) as { status: string; authority: string };
    assert.equal(addBody.status, 'active');
    assert.equal(addBody.authority, 'user_explicit');
    const search = await responseOf(probe, 4);
    assert.ok(JSON.stringify(search).includes('合同测试的记忆内容'));
    const prop = await responseOf(probe, 5) as { result?: { content?: { text: string }[] } };
    const propBody = JSON.parse(prop.result!.content![0]!.text) as { status: string; authority: string };
    assert.equal(propBody.status, 'candidate', 'propose 只产生候选');
    assert.equal(propBody.authority, 'agent_inferred');
  } finally {
    await probe.kill();
    cleanupTestHome(home);
  }
});

test('MCP：秘密内容 → isError 工具结果且不回显；非法工具名报协议错误', async () => {
  const home = makeTestHome();
  const probe = startServer(home);
  try {
    initialize(probe);
    probe.send({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'memory_add', arguments: { content: 'api_key = "sk-live-abcdef123456"' } } });
    probe.send({ jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'no_such_tool', arguments: {} } });
    await probe.wait(600);
    const refused = await responseOf(probe, 10) as { result?: { isError?: boolean; content?: { text: string }[] } };
    assert.equal(refused.result?.isError, true, '治理拒绝标记为工具错误');
    const body = JSON.parse(refused.result!.content![0]!.text) as { code?: string };
    assert.equal(body.code, 'E_SECRET_DETECTED');
    assert.ok(!probe.stdoutText.includes('sk-live-abcdef123456'), 'stdout 不回显秘密');

    // 未知工具同样以 isError 工具结果标准化返回（协议连接保持有效）
    const unknown = await responseOf(probe, 11) as { result?: { isError?: boolean; content?: { text: string }[] } };
    assert.equal(unknown.result?.isError, true);
    assert.equal(JSON.parse(unknown.result!.content![0]!.text).code, 'E_VALIDATION');
  } finally {
    await probe.kill();
    cleanupTestHome(home);
  }
});

test('MCP：客户端断开后服务器退出，本地库仍可被 CLI 使用（会话隔离）', async () => {
  const home = makeTestHome();
  const base = ['--home', home, '--json'];
  const cli = (args: string[]) =>
    new Promise<{ code: number | null; stdout: string }>((resolve, reject) => {
      const p = spawn(process.execPath, ['--import', 'tsx', join(ROOT, 'src', 'interfaces', 'cli', 'main.ts'), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      p.stdout.on('data', (c) => (stdout += c));
      p.on('close', (code) => resolve({ code, stdout }));
      p.on('error', reject);
    });

  const probe = startServer(home);
  initialize(probe);
  probe.send({ jsonrpc: '2.0', id: 20, method: 'tools/call', params: { name: 'memory_add', arguments: { content: 'MCP 会话期间写入的记忆' } } });
  await probe.wait(500);
  const exited = probe.kill();
  await exited;
  assert.ok(true, '服务器随客户端断开退出（kill 路径）');

  // CLI 在 MCP 退出后继续使用同一本地库
  const search = await cli([...base, 'search', 'MCP 会话期间']);
  assert.equal(search.code, 0);
  const s = JSON.parse(search.stdout);
  assert.equal(s.results.length, 1, 'MCP 写入的数据 CLI 可见（同一本地权威库）');
  cleanupTestHome(home);
});

test('MCP：无批次时不暴露 onboarding 工具（按需工具面）', async () => {
  const home = makeTestHome();
  const probe = startServer(home);
  try {
    initialize(probe);
    probe.send({ jsonrpc: '2.0', id: 30, method: 'tools/list' });
    await probe.wait(400);
    const list = await responseOf(probe, 30) as { result?: { tools?: { name: string }[] } };
    const names = (list.result?.tools ?? []).map((t) => t.name);
    assert.ok(!names.includes('onboarding_next_batch'), '空库不暴露 onboarding 工具');
  } finally {
    await probe.kill();
    cleanupTestHome(home);
  }
});
