import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'node:child_process';
import { makeTestHome, cleanupTestHome } from '../helpers.js';
import { mcpServerEntry } from '../spawn-target.js';

/**
 * MCP 全链路回归（宿主接入验证，2026-10-28）：
 * 补齐 mcp.test.ts 未覆盖的读侧细节——memory_get/update/context/status 的返回形态、
 * 修订留痕（不无痕覆盖）、遗忘墓碑可审计、遗忘后检索归零。
 *
 * 背景：宿主接入阶段曾出现「零输出 + 退出码 0」的假绿冒烟脚本（读错字段 results
 * 且 finally 内 process.exit(0) 吞异常）。本用例锁定真实字段与真实状态迁移，
 * 避免同类假绿再以脚本形式回归。
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

async function waitReady(probe: Probe, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (probe.stderrText.includes('stdio server ready')) return;
    if (Date.now() - start > timeoutMs) throw new Error(`MCP 服务器启动超时；stderr=${probe.stderrText.slice(0, 200)}`);
    await probe.wait(20);
  }
}

async function responseOf(probe: Probe, id: number, timeoutMs = 15000): Promise<Record<string, unknown>> {
  const start = Date.now();
  for (;;) {
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
    if (Date.now() - start > timeoutMs) throw new Error(`等待 id=${id} 响应超时；stdout=${probe.stdoutText.slice(0, 400)}`);
    await probe.wait(40);
  }
}

/** 调用工具并解析 JSON 工具结果（MCP 把业务体放在 content[0].text）。 */
async function callTool(probe: Probe, id: number, name: string, args: Record<string, unknown>): Promise<{ isError: boolean | null; body: Record<string, unknown> }> {
  probe.send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
  const r = (await responseOf(probe, id)) as { result?: { isError?: boolean; content?: { text: string }[] } };
  const text = r.result?.content?.[0]?.text ?? '{}';
  return { isError: r.result?.isError ?? null, body: JSON.parse(text) as Record<string, unknown> };
}

const itemsOf = (body: Record<string, unknown>): { id?: string }[] => (Array.isArray(body['items']) ? (body['items'] as { id?: string }[]) : []);

test('MCP 全链路：修订留痕、墓碑可审计、遗忘后检索归零、读侧返回形态', async () => {
  const home = makeTestHome();
  const probe = startServer(home);
  try {
    await waitReady(probe);
    probe.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'roundtrip-test', version: '0' } } });
    probe.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    await responseOf(probe, 1);

    // 1. 写入
    const added = await callTool(probe, 2, 'memory_add', { content: '全链路探针：修订留痕与墓碑（合成）', kind: 'fact' });
    const memId = String(added.body['id']);
    assert.equal(added.isError, null);
    assert.equal(added.body['status'], 'active');
    assert.equal(added.body['authority'], 'user_explicit');
    assert.ok(memId, 'memory_add 必须返回 id');

    // 2. 读侧：memory_get 返回详情（memory + revisions + tombstone 字段）
    const before = await callTool(probe, 3, 'memory_get', { id: memId });
    const beforeMemory = before.body['memory'] as { id?: string; content?: string };
    assert.equal(beforeMemory?.id, memId);
    const revisionsBefore = before.body['revisions'] as unknown[];
    assert.ok(Array.isArray(revisionsBefore), 'memory_get 必须返回 revisions 数组');
    assert.equal(revisionsBefore.length, 1, '首次写入应有 1 条修订');
    assert.equal(before.body['tombstone'], null, '未遗忘时无墓碑');

    // 3. 更正：追加新修订，不无痕覆盖
    const updated = await callTool(probe, 4, 'memory_update', { id: memId, content: '全链路探针（已更正）：修订留痕与墓碑（合成）', reason: 'roundtrip-test' });
    assert.equal(updated.isError, null);
    assert.ok(String(updated.body['revisionId'] ?? ''), 'memory_update 必须返回新 revisionId');
    assert.equal(updated.body['status'], 'active');

    const after = await callTool(probe, 5, 'memory_get', { id: memId });
    const revisionCount = (after.body['revisions'] as unknown[]).length;
    assert.equal(revisionCount, 2, '更正后应保留 2 条修订（历史不被覆盖）');
    const afterMemory = after.body['memory'] as { content?: string };
    assert.ok(String(afterMemory.content).includes('已更正'), '当前内容应为更正后的文本');

    // 4. 检索命中（真实返回字段是 items，不是 results）
    const searchHits = await callTool(probe, 6, 'memory_search', { query: '全链路探针' });
    assert.ok(Array.isArray(searchHits.body['items']), 'memory_search 必须返回 items 数组');
    assert.equal(searchHits.body['results'], undefined, '不应再出现 results 别名（防假绿回归）');
    assert.ok(itemsOf(searchHits.body).some((x) => x.id === memId), '检索应命中刚写入的记忆');

    // 5. 遗忘：墓碑可审计
    const forgotten = await callTool(probe, 7, 'memory_forget', { id: memId, reason: 'roundtrip-test 清理' });
    assert.equal(forgotten.isError, null);
    assert.equal(forgotten.body['status'], 'tombstoned');

    const tomb = await callTool(probe, 8, 'memory_get', { id: memId });
    const tombstone = tomb.body['tombstone'] as { reason?: string } | null;
    assert.ok(tombstone, '遗忘后必须能读到墓碑（可审计）');
    assert.equal(tombstone?.reason, 'roundtrip-test 清理', '墓碑保留遗忘原因');

    // 6. 遗忘后检索归零
    const afterForget = await callTool(probe, 9, 'memory_search', { query: '全链路探针' });
    assert.equal(
      itemsOf(afterForget.body).filter((x) => x.id === memId).length,
      0,
      '遗忘后检索不应再返回该条',
    );

    // 7. memory_context / memory_status 返回形态
    const ctx = await callTool(probe, 10, 'memory_context', {});
    assert.ok(Array.isArray(ctx.body['items']), 'memory_context 必须返回 items 数组');
    assert.ok('why_recalled' in ctx.body, 'memory_context 必须说明召回理由');

    const status = await callTool(probe, 11, 'memory_status', {});
    const memories = status.body['memories'] as Record<string, number>;
    assert.ok(memories && typeof memories === 'object', 'memory_status 必须返回 memories 计数');
    assert.equal(memories['tombstoned'], 1, '计数应反映 1 条墓碑');
    assert.equal(memories['active'], 0, '计数应反映 0 条活动记忆');
    assert.ok(String(status.body['device'] ?? '').startsWith('dev_'), 'memory_status 必须返回设备 id');

    // 8. stdout 纯净：每行都是合法 JSON-RPC
    for (const line of probe.stdoutText.trim().split('\n').filter(Boolean)) {
      const parsed = JSON.parse(line) as { jsonrpc?: string };
      assert.equal(parsed.jsonrpc, '2.0', 'stdout 只允许 JSON-RPC');
    }
  } finally {
    await probe.kill();
    cleanupTestHome(home);
  }
});
