import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'node:child_process';
import { AppService } from '../../src/interfaces/app-service.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';
import { mcpServerEntry } from '../spawn-target.js';

/**
 * MCP 修订提案工具（add-agent-managed-revision 任务 5.4）：
 * 工具面不含 apply 类工具；propose 后记忆不变；list 返回正文对照。
 */

const SERVER = mcpServerEntry();

interface Probe {
  proc: ChildProcess;
  stdoutText: string;
  stderrText: string;
  send(obj: unknown): void;
  wait(ms: number): Promise<void>;
  kill(): Promise<void>;
}

function startServer(home: string): Probe {
  const p = spawn(process.execPath, [...SERVER.loader, SERVER.file, '--home', home], { stdio: ['pipe', 'pipe', 'pipe'] });
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
        if (p.exitCode !== null || p.signalCode !== null) {
          r();
          return;
        }
        p.once('close', () => r());
        p.kill();
      });
    },
  };
  p.stdout!.on('data', (c) => (probe.stdoutText += String(c)));
  p.stderr!.on('data', (c) => (probe.stderrText += String(c)));
  return probe;
}

async function waitReady(probe: Probe, timeoutMs = 20000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (probe.stderrText.includes('stdio server ready')) return;
    if (Date.now() - start > timeoutMs) throw new Error(`MCP 服务器启动超时；stderr=${probe.stderrText.slice(0, 200)}`);
    await probe.wait(20);
  }
}

async function responseOf(probe: Probe, id: number, timeoutMs = 20000): Promise<Record<string, unknown>> {
  const start = Date.now();
  for (;;) {
    // SDK 响应的键序不保证 jsonrpc 在前，按解析后的 id 匹配（与 mcp-roundtrip 同姿势）
    const line = probe.stdoutText
      .trim()
      .split('\n')
      .filter(Boolean)
      .find((l) => {
        try {
          return (JSON.parse(l) as { id?: number }).id === id;
        } catch {
          return false;
        }
      });
    if (line) return JSON.parse(line) as Record<string, unknown>;
    if (Date.now() - start > timeoutMs) throw new Error(`MCP 响应超时；stdout=${probe.stdoutText.slice(0, 300)}`);
    await probe.wait(20);
  }
}

test('revision 工具面：propose/list 可用，无 apply 类工具；propose 后记忆不变', async () => {
  const home = makeTestHome('cairn-rev-mcp-');
  const probe = startServer(home);
  try {
    await waitReady(probe);
    // SDK 要求先握手：initialize → initialized notification
    probe.send({ jsonrpc: '2.0', id: 900, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'rev-test', version: '0' } } });
    probe.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    await responseOf(probe, 900);
    let nextId = 901;
    const call = async (name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const id = nextId++;
      probe.send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
      const resp = await responseOf(probe, id);
      const content = (resp['result'] as { content?: { type: string; text: string }[] })['content'];
      return JSON.parse(content?.[0]?.text ?? '{}') as Record<string, unknown>;
    };

    // 预置一条记忆（直接开库写，MCP 进程随后读到）
    const svc = AppService.open(home);
    const memId = svc.addMemory({ content: '会话存储路径是 ~/.workbuddy/mcp.json' }).memory!.id;
    svc.close();

    // 工具面：列工具，断言无 apply
    const listId = nextId++;
    probe.send({ jsonrpc: '2.0', id: listId, method: 'tools/list', params: {} });
    const toolsResp = await responseOf(probe, listId);
    const tools = (toolsResp['result'] as { tools: { name: string }[] }).tools.map((t) => t.name);
    assert.ok(tools.includes('revision_propose'), 'revision_propose 在工具面');
    assert.ok(tools.includes('revision_list'), 'revision_list 在工具面');
    const applyLike = tools.filter((n) => n.toLowerCase().includes('apply') || n.includes('revision_apply') || n.includes('revision_reject'));
    assert.deepEqual(applyLike, [], `工具面不得含应用/拒绝类工具，实际：${applyLike.join(',')}`);

    // propose：返回提案 id，返回值里明确告知无应用能力
    const r = await call('revision_propose', {
      memory_id: memId,
      after_content: '会话存储路径是 ~/.workbuddy/mcp.json（DSH 例外走 Cordis）',
      reason: '按 DSH 接入事实补充例外说明',
    });
    const proposalId = String(r['proposalId']);
    assert.ok(proposalId.startsWith('rev_'), '返回提案标识');
    assert.equal(r['status'], 'pending');

    // propose 后记忆逐字段不变
    const svc2 = AppService.open(home);
    try {
      const mem = svc2.store.memories.require(memId);
      assert.equal(mem.content, '会话存储路径是 ~/.workbuddy/mcp.json');
      assert.equal(mem.authority, 'user_explicit');
      assert.equal(mem.currentRevisionId, svc2.listRevisionProposals({ status: 'pending' })[0]!.revisionIdAtPropose);
    } finally {
      svc2.close();
    }

    // list：默认待审，返回正文对照与元信息
    const lr = await call('revision_list', {});
    const items = lr['items'] as { id: string; beforeExcerpt: string | null; afterContent: string; proposedBy: string }[];
    assert.equal(items.length, 1);
    assert.equal(items[0]!.id, proposalId);
    assert.ok(items[0]!.afterContent.includes('Cordis'));
    assert.ok(items[0]!.beforeExcerpt!.includes('mcp.json'));
    assert.ok(items[0]!.proposedBy.startsWith('mcp:'), '提出者标明 Agent 通道');
  } finally {
    await probe.kill();
    cleanupTestHome(home);
  }
});
