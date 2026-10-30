import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTestHome, cleanupTestHome } from '../helpers.js';
import { cliEntry } from '../spawn-target.js';
import { openStore } from '../../src/store/index.js';
import { importSnapshot } from '../../src/onboarding/import.js';
import { assignBatch } from '../../src/onboarding/batches.js';
import { signPolicy } from '../../src/onboarding/policy.js';

/**
 * `memory_decide` 的合同（任务 6.3 / design D6）。
 *
 * 核心边界：这条通道能消费已签发策略，但**不能签发策略**。
 * 所以这里既验证三步闭环，也验证越权路径确实不存在。
 */

const { mcpServerEntry } = await import('../spawn-target.js');
const serverTarget = mcpServerEntry();
const CLI = cliEntry();

interface Probe {
  proc: ChildProcess;
  stdoutText: string;
  stderrText: string;
  send(obj: unknown): void;
  wait(ms: number): Promise<void>;
  stdoutLines(): unknown[];
  kill(): Promise<void>;
}

function startServer(home: string): Probe {
  const p = spawn(process.execPath, [...serverTarget.loader, serverTarget.file, '--home', home], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
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
    stdoutLines() {
      return probe.stdoutText.trim().split('\n').filter(Boolean);
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
    if (Date.now() - start > timeoutMs) throw new Error(`MCP 启动超时；stderr=${probe.stderrText.slice(0, 200)}`);
    await probe.wait(20);
  }
}

function initialize(probe: Probe): void {
  probe.send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'decide-test', version: '0' } },
  });
  probe.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
}

async function responseOf(probe: Probe, id: number, timeoutMs = 20000): Promise<Record<string, unknown>> {
  const start = Date.now();
  for (;;) {
    const line = probe.stdoutLines()
      .map((l) => String(l))
      .find((l) => (JSON.parse(l) as { id?: number }).id === id);
    if (line) return JSON.parse(line) as Record<string, unknown>;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`等待 id=${id} 超时；stdout=${probe.stdoutText.slice(0, 400)}`);
    }
    await probe.wait(50);
  }
}

function callArgs(res: Record<string, unknown>): Record<string, unknown> {
  const result = res['result'] as { content?: { text: string }[]; isError?: boolean } | undefined;
  const text = result?.content?.[0]?.text ?? '{}';
  return JSON.parse(text) as Record<string, unknown>;
}

interface Seeded {
  home: string;
  batchId: string;
  itemIds: string[];
  cleanup(): void;
}

async function seeded(): Promise<Seeded> {
  const home = makeTestHome('cairn-decide-');
  const store = openStore({ home });
  try {
    const dir = join(home, 'sources');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'notes.md');
    writeFileSync(
      file,
      ['生产环境数据库端口是 5433，连接超时 60 秒。', '构建命令是 pnpm build，产物目录是 dist。', '发布流程第一步是冻结主干分支。'].join('\n\n') + '\n',
      'utf8',
    );
    const out = await importSnapshot(store, { agentKind: 'manual', sourcePath: file });
    const archiveId = (out.archiveId ?? out.reusedArchiveId)!;
    const batchId = assignBatch(store, archiveId);
    const itemIds = store.db
      .all("SELECT id FROM import_item WHERE batch_id = ? AND scan_state = 'clean' ORDER BY id", batchId)
      .map((r) => String(r.id));
    return {
      home,
      batchId,
      itemIds,
      cleanup() {
        cleanupTestHome(home);
      },
    };
  } finally {
    store.close();
  }
}

test('memory_decide 存在，且 schema 没有签发策略或指定通道的入口', async () => {
  const home = makeTestHome('cairn-decide-');
  const probe = startServer(home);
  try {
    await waitReady(probe);
    initialize(probe);
    probe.send({ jsonrpc: '2.0', id: 10, method: 'tools/list' });
    await responseOf(probe, 1);
    const list = (await responseOf(probe, 10)) as { result?: { tools?: { name: string; inputSchema?: Record<string, unknown> }[] } };
    const tools = list.result?.tools ?? [];
    const t = tools.find((x) => x.name === 'memory_decide');
    assert.ok(t, '缺少 memory_decide');
    const schema = (t!.inputSchema ?? {}) as { properties?: Record<string, unknown> };
    const props = Object.keys(schema.properties ?? {});
    for (const forbidden of ['channel', 'approved_by', 'allowedScopes', 'maxSensitivity', 'minConfidence', 'spec']) {
      assert.equal(props.includes(forbidden), false, `不得接受 ${forbidden} 字段`);
    }
    // auto 只能引用策略 id，不能内联策略内容
    assert.ok(props.includes('policy_id'), '必须用 policy_id 引用已签发策略');
  } finally {
    await probe.kill();
    cleanupTestHome(home);
  }
});

test('三步闭环：next → submit → auto', async () => {
  const s = await seeded();
  signPolicy(
    s.home,
    {
      id: 'mcp-auto',
      allowedScopes: ['personal-global'],
      maxSensitivity: 'normal',
      requireAiAgreement: false,
      allowCreate: true,
      minConfidence: 0.6,
      note: 'MCP 闭环测试',
    },
    { via: 'cli' },
  );
  const probe = startServer(s.home);
  try {
    await waitReady(probe);
    initialize(probe);

    // 1. next
    probe.send({
      jsonrpc: '2.0',
      id: 20,
      method: 'tools/call',
      params: { name: 'memory_decide', arguments: { action: 'next', batch_id: s.batchId, limit: 5 } },
    });
    await responseOf(probe, 1);
    const next = callArgs(await responseOf(probe, 20)) as { batchId: string; items: unknown[] };
    assert.equal(next.batchId, s.batchId);
    assert.ok(next.items.length > 0, '应返回待判断条目');

    // 2. submit：给第一条一个明确判断
    probe.send({
      jsonrpc: '2.0',
      id: 21,
      method: 'tools/call',
      params: {
        name: 'memory_decide',
        arguments: {
          action: 'submit',
          items: [{ itemId: s.itemIds[0], action: 'promote', reason: '环境事实，长期有效', confidence: 'high' }],
        },
      },
    });
    const submit = callArgs(await responseOf(probe, 21)) as { accepted: number; rejected?: number };
    assert.equal(submit.accepted, 1);

    // 3. auto：按已签发策略应用
    probe.send({
      jsonrpc: '2.0',
      id: 22,
      method: 'tools/call',
      params: { name: 'memory_decide', arguments: { action: 'auto', batch_id: s.batchId, policy_id: 'mcp-auto' } },
    });
    const auto = callArgs(await responseOf(probe, 22)) as { applied: number; balanced: boolean; manual: number };
    assert.ok(auto.applied >= 1, `应至少应用一条，实际 ${auto.applied}`);
    assert.equal(auto.balanced, true, `汇总不平：${JSON.stringify(auto)}`);
  } finally {
    await probe.kill();
    s.cleanup();
  }
});

test('越界条目：整批拒绝，一条都不写', async () => {
  const s = await seeded();
  const probe = startServer(s.home);
  try {
    await waitReady(probe);
    initialize(probe);
    probe.send({
      jsonrpc: '2.0',
      id: 30,
      method: 'tools/call',
      params: {
        name: 'memory_decide',
        arguments: {
          action: 'submit',
          items: [
            { itemId: s.itemIds[0], action: 'promote', reason: '合理', confidence: 'high' },
            { itemId: '01j-not-in-this-batch', action: 'promote', reason: '越界', confidence: 'high' },
          ],
        },
      },
    });
    await responseOf(probe, 1);
    const res = await responseOf(probe, 30);
    const body = JSON.stringify(res);
    assert.ok(body.includes('整批拒绝') || body.includes('isError'), `应整批拒绝，实际 ${body.slice(0, 300)}`);

    // 拒绝后 list 应为空：不能出现"合法的那条被写进去了"
    probe.send({
      jsonrpc: '2.0',
      id: 31,
      method: 'tools/call',
      params: { name: 'memory_review', arguments: { action: 'list', batch_id: s.batchId } },
    });
    const listed = callArgs(await responseOf(probe, 31));
    assert.deepEqual(listed, [], '整批拒绝后不得残留部分写入');
  } finally {
    await probe.kill();
    s.cleanup();
  }
});

test('auto 不能凭空造策略：未签发的 policy_id 被拒', async () => {
  const s = await seeded();
  const probe = startServer(s.home);
  try {
    await waitReady(probe);
    initialize(probe);
    probe.send({
      jsonrpc: '2.0',
      id: 40,
      method: 'tools/call',
      params: { name: 'memory_decide', arguments: { action: 'auto', batch_id: s.batchId, policy_id: 'i-just-made-this-up' } },
    });
    await responseOf(probe, 1);
    const res = await responseOf(probe, 40);
    const body = JSON.stringify(res);
    assert.ok(body.includes('策略不存在') || body.includes('policy sign') || body.includes('isError'), body.slice(0, 300));

    // 缺 policy_id 时也不能默认放行
    probe.send({
      jsonrpc: '2.0',
      id: 41,
      method: 'tools/call',
      params: { name: 'memory_decide', arguments: { action: 'auto', batch_id: s.batchId } },
    });
    const res2 = await responseOf(probe, 41);
    assert.ok(JSON.stringify(res2).includes('policy_id') || JSON.stringify(res2).includes('isError'));
  } finally {
    await probe.kill();
    s.cleanup();
  }
});

test('已落库的判断不被事后通道覆盖：auto 后记忆数符合预期', async () => {
  const s = await seeded();
  signPolicy(
    s.home,
    {
      id: 'mcp-once',
      allowedScopes: ['personal-global'],
      maxSensitivity: 'normal',
      requireAiAgreement: false,
      allowCreate: true,
      minConfidence: 0.6,
      note: '',
    },
    { via: 'cli' },
  );
  const probe = startServer(s.home);
  try {
    await waitReady(probe);
    initialize(probe);
    probe.send({
      jsonrpc: '2.0',
      id: 50,
      method: 'tools/call',
      params: { name: 'memory_decide', arguments: { action: 'auto', batch_id: s.batchId, policy_id: 'mcp-once' } },
    });
    await responseOf(probe, 1);
    const auto = callArgs(await responseOf(probe, 50)) as { applied: number };

    // 第二次 auto：不应把同一批条目重复写成两倍记忆
    probe.send({
      jsonrpc: '2.0',
      id: 51,
      method: 'tools/call',
      params: { name: 'memory_decide', arguments: { action: 'auto', batch_id: s.batchId, policy_id: 'mcp-once' } },
    });
    const again = callArgs(await responseOf(probe, 51)) as { applied: number; skipped: number };

    const store = openStore({ home: s.home, readOnly: true });
    try {
      const active = Number(store.db.get("SELECT count(*) AS n FROM memory WHERE status='active'")!.n);
      assert.ok(active <= auto.applied, `第二次不应新增记忆：首次 ${auto.applied}，现库 ${active}`);
      assert.equal(again.applied, 0, `重复运行应为幂等，实际又应用了 ${again.applied} 条`);
    } finally {
      store.close();
    }
  } finally {
    await probe.kill();
    s.cleanup();
  }
});
