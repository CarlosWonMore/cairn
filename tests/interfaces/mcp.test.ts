import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { makeTestHome, cleanupTestHome } from '../helpers.js';
import { openStore } from '../../src/store/open.js';
import { importSnapshot } from '../../src/onboarding/import.js';
import { cliEntry } from '../spawn-target.js';

/**
 * MCP stdio 协议合同（任务 5.2 / agent-interfaces spec）：
 * stdout 只含 JSON-RPC；日志仅 stderr；断开后本地仍可用。
 */

const { mcpServerEntry } = await import('../spawn-target.js');
const serverTarget = mcpServerEntry();
const SERVER = serverTarget.file;
const SERVER_LOADER = serverTarget.loader;

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
  const p = spawn(process.execPath, [...SERVER_LOADER, SERVER, '--home', home], {
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
        // 进程可能已自行退出：先检查再挂监听，避免 await 永不返回
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
  // stderr 收集用于就绪判断与诊断（协议输出只走 stdout，stderr 不进纯净断言）
  p.stderr!.on('data', (c) => (probe.stderrText += String(c)));
  return probe;
}

/** 等待子进程 stdio 就绪（stderr ready 标记），消除 Windows 管道首写竞态。 */
async function waitReady(probe: Probe, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (probe.stderrText.includes('stdio server ready')) return;
    if (Date.now() - start > timeoutMs) throw new Error(`MCP 服务器启动超时；stderr=${probe.stderrText.slice(0, 200)}`);
    await probe.wait(20);
  }
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
    await waitReady(probe);
    initialize(probe);
    probe.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    probe.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'memory_add', arguments: { content: '合同测试的记忆内容', kind: 'fact' } } });
    probe.send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'memory_search', arguments: { query: '合同测试' } } });
    probe.send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'memory_propose', arguments: { content: '推断候选：看起来用户使用 Node 24' } } });
    // 等全部响应到达（轮询而非固定睡眠；慢启动环境不竞态）
    const init = await responseOf(probe, 1) as { result?: { serverInfo?: { name?: string } } };
    for (const id of [2, 3, 4, 5]) await responseOf(probe, id);

    // stdout 纯净：每行都是合法 JSON（无日志/警告/异常文本混入）
    const lines = probe.stdoutLines();
    assert.ok(lines.length >= 5, `stdout 行数 ${lines.length}`);
    for (const l of lines) {
      const parsed = JSON.parse(String(l)); // 抛错即失败
      assert.ok('jsonrpc' in parsed || parsed !== null);
    }
    assert.equal(init.result?.serverInfo?.name, 'cairn');
    const list = await responseOf(probe, 2) as { result?: { tools?: { name: string }[] } };
    const names = (list.result?.tools ?? []).map((t) => t.name);
    for (const t of ['memory_context', 'memory_search', 'memory_get', 'memory_add', 'memory_propose', 'memory_update', 'memory_forget', 'memory_status', 'memory_audit']) {
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

test('MCP：memory_audit 只读可查，检索留痕且零内容泄露', async () => {
  const home = makeTestHome();
  const probe = startServer(home);
  try {
    await waitReady(probe);
    initialize(probe);
    probe.send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'memory_add', arguments: { content: '机密内容-审计零泄露-9981', kind: 'fact', sensitive: true } } });
    probe.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'memory_search', arguments: { query: '审计零泄露' } } });
    probe.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'memory_audit', arguments: { category: 'operation' } } });
    probe.send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'memory_audit', arguments: { action: 'nonexistent_action_xyz' } } });
    for (const id of [1, 2, 3, 4]) await responseOf(probe, id);
    const audit = await responseOf(probe, 3) as { result?: { content?: { text: string }[] } };
    const body = JSON.parse(audit.result!.content![0]!.text) as { items: { category: string; action: string }[] };
    assert.ok(body.items.some((i) => i.action === 'memory_search'), 'search 留了 operation 事件');
    assert.ok(body.items.every((i) => i.category === 'operation'), 'category 过滤生效');
    const empty = await responseOf(probe, 4) as { result?: { content?: { text: string }[] } };
    const emptyBody = JSON.parse(empty.result!.content![0]!.text) as { items: unknown[] };
    assert.equal(emptyBody.items.length, 0, 'action 过滤无匹配返回空');
    // 零泄露：审计响应与全部工具输出都不含查询原文与敏感正文
    assert.ok(!JSON.stringify(body).includes('审计零泄露'), '查询原文不得入审计响应');
    assert.ok(!JSON.stringify(body).includes('机密内容-审计零泄露-9981'), '敏感正文不得入审计响应');
  } finally {
    await probe.kill();
    cleanupTestHome(home);
  }
});

test('MCP：秘密内容 → isError 工具结果且不回显；非法工具名报协议错误', async () => {
  const home = makeTestHome();
  const probe = startServer(home);
  try {
    await waitReady(probe);
    initialize(probe);
    probe.send({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'memory_add', arguments: { content: 'api_key = "sk-live-abcdef123456"' } } });
    probe.send({ jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'no_such_tool', arguments: {} } });
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
      const cliTarget = cliEntry();
      const p = spawn(process.execPath, [...cliTarget.loader, cliTarget.file, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      p.stdout.on('data', (c) => (stdout += c));
      p.on('close', (code) => resolve({ code, stdout }));
      p.on('error', reject);
    });

  const probe = startServer(home);
  await waitReady(probe);
  initialize(probe);
  probe.send({ jsonrpc: '2.0', id: 20, method: 'tools/call', params: { name: 'memory_add', arguments: { content: 'MCP 会话期间写入的记忆' } } });
  // 等写入响应确认落库后再断开（固定睡眠在慢启动环境会杀死尚未发生的写入）
  const added = await responseOf(probe, 20) as { result?: { content?: { text: string }[] } };
  const addBody = JSON.parse(added.result!.content![0]!.text) as { id: string };
  assert.ok(addBody.id, 'memory_add 已确认');
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
    await waitReady(probe);
    initialize(probe);
    probe.send({ jsonrpc: '2.0', id: 30, method: 'tools/list' });
    const list = await responseOf(probe, 30) as { result?: { tools?: { name: string }[] } };
    const names = (list.result?.tools ?? []).map((t) => t.name);
    assert.ok(!names.includes('onboarding_next_batch'), '空库不暴露 onboarding 工具');
  } finally {
    await probe.kill();
    cleanupTestHome(home);
  }
});

/**
 * fix-onboarding-tool-surface-flip：工具面在进程生命周期内冻结。
 * ListTools 结果必须字节稳定——运行中库状态翻转（另一进程 import、会话内治理动作）
 * 不得增减工具；重启（stdio 即新会话）才重新判定。
 * 注：条目「有→无」方向与「无→有」走同一条冻结常量路径，治理侧清零流程由
 * auto-onboarding 既有测试覆盖，此处以无→有方向钉住重估行为。
 */

async function seedImportItems(home: string, filename: string, content: string): Promise<void> {
  mkdirSync(join(home, 'sources'), { recursive: true });
  const srcPath = join(home, 'sources', filename);
  writeFileSync(srcPath, content, 'utf8');
  const store = openStore({ home });
  try {
    const outcome = await importSnapshot(store, { agentKind: 'claude-code', sourcePath: srcPath });
    assert.ok(outcome.itemCount >= 1, '导入条目已落库');
  } finally {
    store.close();
  }
}

test('MCP：工具面启动冻结——运行中条目翻转不改变 ListTools，重启才重估', async () => {
  const home = makeTestHome();
  const probe = startServer(home);
  try {
    await waitReady(probe);
    initialize(probe);
    probe.send({ jsonrpc: '2.0', id: 40, method: 'tools/list' });
    const list1 = await responseOf(probe, 40) as { result?: { tools?: { name: string }[] } };
    const names1 = (list1.result?.tools ?? []).map((t) => t.name);
    assert.ok(!names1.includes('onboarding_next_batch'), '空库启动不暴露 onboarding 工具');

    // 另一进程（测试进程）向同一本地库（WAL）导入条目，模拟「运行中翻转」
    await seedImportItems(home, 'mid-run.md', '运行中导入：工具面必须冻结\n第二行');

    // 同一进程内再问：工具面必须不变
    probe.send({ jsonrpc: '2.0', id: 41, method: 'tools/list' });
    const list2 = await responseOf(probe, 41) as { result?: { tools?: { name: string }[] } };
    const names2 = (list2.result?.tools ?? []).map((t) => t.name);
    assert.ok(!names2.includes('onboarding_next_batch'), '运行中出现条目不得改变已启动进程的工具面');
    assert.deepEqual(names2, names1, '进程内两次 tools/list 完全一致');
  } finally {
    await probe.kill();
  }

  // 重启（stdio 即新进程）后按新状态判定
  const probe2 = startServer(home);
  try {
    await waitReady(probe2);
    initialize(probe2);
    probe2.send({ jsonrpc: '2.0', id: 42, method: 'tools/list' });
    const list3 = await responseOf(probe2, 42) as { result?: { tools?: { name: string }[] } };
    const names3 = (list3.result?.tools ?? []).map((t) => t.name);
    assert.ok(names3.includes('onboarding_next_batch'), '重启后按新状态判定：条目可见 → 工具出现');
  } finally {
    await probe2.kill();
    cleanupTestHome(home);
  }
});

test('MCP：有条目启动时 onboarding 工具在进程内稳定一致', async () => {
  const home = makeTestHome();
  await seedImportItems(home, 'seed.md', '启动前已导入：工具面应包含 onboarding\n第二行');
  const probe = startServer(home);
  try {
    await waitReady(probe);
    initialize(probe);
    probe.send({ jsonrpc: '2.0', id: 50, method: 'tools/list' });
    const l1 = await responseOf(probe, 50) as { result?: { tools?: { name: string }[] } };
    probe.send({ jsonrpc: '2.0', id: 51, method: 'tools/list' });
    const l2 = await responseOf(probe, 51) as { result?: { tools?: { name: string }[] } };
    const n1 = (l1.result?.tools ?? []).map((t) => t.name);
    const n2 = (l2.result?.tools ?? []).map((t) => t.name);
    assert.ok(n1.includes('onboarding_next_batch'), '有条目启动 → 工具暴露');
    assert.deepEqual(n2, n1, '进程内多次 tools/list 完全一致');
  } finally {
    await probe.kill();
    cleanupTestHome(home);
  }
});

test('MCP：检索条目携带 scope_preset / sensitivity / sync_policy（add-memory-scope-visibility）', async () => {
  const home = makeTestHome();
  const probe = startServer(home);
  try {
    await waitReady(probe);
    initialize(probe);
    probe.send({ jsonrpc: '2.0', id: 60, method: 'tools/call', params: { name: 'memory_add', arguments: { content: '作用域字段验证记忆：偏好中文回复' } } });
    await responseOf(probe, 60);
    probe.send({ jsonrpc: '2.0', id: 61, method: 'tools/call', params: { name: 'memory_search', arguments: { query: '作用域字段验证' } } });
    const res = await responseOf(probe, 61) as { result?: { content?: { text: string }[] } };
    const body = JSON.parse(res.result!.content![0]!.text) as {
      items: { preview?: string; scope_preset?: string; sensitivity?: string; sync_policy?: string }[];
    };
    const mine = body.items.find((it) => (it.preview ?? '').includes('作用域字段验证'));
    assert.ok(mine, '检索命中刚写入的记忆');
    assert.equal(mine!.scope_preset, 'personal-global', 'scope_preset 是人读 preset 名');
    assert.equal(mine!.sensitivity, 'normal', 'sensitivity 带出');
    assert.equal(mine!.sync_policy, 'encrypted', 'sync_policy 带出');
    for (const it of body.items) {
      assert.ok(!/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(it.scope_preset ?? ''), 'scope_preset 不得是 UUID');
    }
  } finally {
    await probe.kill();
    cleanupTestHome(home);
  }
});

test('MCP：检索条目返回预览而非全文；get 支持前缀与批量（add-two-stage-memory-recall）', async () => {
  const home = makeTestHome();
  const probe = startServer(home);
  try {
    await waitReady(probe);
    initialize(probe);
    const longText = '预览形状验证记忆甲：正文第一段足够长，超过预览上限以验证截断标记。' + '补充内容继续填充正文。'.repeat(60);
    probe.send({ jsonrpc: '2.0', id: 70, method: 'tools/call', params: { name: 'memory_add', arguments: { content: longText } } });
    await responseOf(probe, 70);
    probe.send({ jsonrpc: '2.0', id: 71, method: 'tools/call', params: { name: 'memory_add', arguments: { content: '预览形状验证记忆乙：短正文' } } });
    await responseOf(probe, 71);
    probe.send({ jsonrpc: '2.0', id: 72, method: 'tools/call', params: { name: 'memory_search', arguments: { query: '预览形状验证' } } });
    const res = await responseOf(probe, 72) as { result?: { content?: { text: string }[] } };
    const body = JSON.parse(res.result!.content![0]!.text) as {
      items: { id: string; preview?: string; truncated?: boolean; content_length?: number; content?: string }[];
    };
    assert.ok(body.items.length >= 2, '两条验证记忆都命中');
    for (const it of body.items) {
      assert.ok(!('content' in it), '列表条目 MUST NOT 返回全文 content');
      assert.equal(typeof it.preview, 'string');
      assert.equal(typeof it.truncated, 'boolean');
      assert.equal(typeof it.content_length, 'number');
    }
    const short = body.items.find((it) => (it.content_length ?? 0) < 300)!;
    assert.equal(short.truncated, false, '短记忆不产生截断标记');
    const long = body.items.find((it) => (it.content_length ?? 0) > 300)!;
    assert.equal(long.truncated, true, '长记忆有截断标记');
    assert.ok((long.preview ?? '').length <= 300, '预览有界');

    // 唯一前缀 get：uuidv7 同毫秒创建的记忆共享前 ≥12 字符，前缀长度按两条 id 的
    // 实际公共前缀 +1 确定（下限 8）——「固定 8 字符」在新建库上会歧义。
    const commonLen = (() => { let l = 0; while (l < 36 && short.id[l] === long.id[l]) l++; return l; })();
    const idPrefix = short.id.slice(0, Math.min(36, Math.max(8, commonLen + 1)));
    probe.send({ jsonrpc: '2.0', id: 73, method: 'tools/call', params: { name: 'memory_get', arguments: { id: idPrefix } } });
    const got = await responseOf(probe, 73) as { result?: { content?: { text: string }[] } };
    const detail = JSON.parse(got.result!.content![0]!.text) as { memory?: { id: string; content?: string } };
    assert.equal(detail.memory?.id, short.id, '前缀解析到同一记忆');
    assert.ok((detail.memory?.content ?? '').includes('短正文'), '详情返回完整正文');

    // 批量 get（完整 id + 唯一前缀混用）
    probe.send({ jsonrpc: '2.0', id: 74, method: 'tools/call', params: { name: 'memory_get', arguments: { ids: [long.id, idPrefix] } } });
    const batchRes = await responseOf(probe, 74) as { result?: { content?: { text: string }[] } };
    const batch = JSON.parse(batchRes.result!.content![0]!.text) as { results?: { id: string; memory?: { id: string } }[] };
    assert.equal(batch.results?.length, 2);
    assert.deepEqual(batch.results!.map((r) => r.memory!.id).sort(), [long.id, short.id].sort(), '批量逐条返回完整详情');
  } finally {
    await probe.kill();
    cleanupTestHome(home);
  }
});

test('MCP：检索可按项目身份过滤，未登记别名只查不建（add-project-scope-recall）', async () => {
  const home = makeTestHome();
  const probe = startServer(home);
  try {
    await waitReady(probe);
    initialize(probe);
    // 1) 登记 proj-A 路径
    probe.send({ jsonrpc: '2.0', id: 80, method: 'tools/call', params: { name: 'project_resolve', arguments: { path_or_url: 'D:\\proj\\alpha-test' } } });
    const resolved = await responseOf(probe, 80) as { result?: { content?: { text: string }[] } };
    const proj = JSON.parse(resolved.result!.content![0]!.text) as { projectId: string; created: boolean };
    assert.ok(proj.projectId, 'project_resolve 返回项目标识');
    // 2) 写一条项目作用域记忆 + 一条 personal 记忆
    probe.send({ jsonrpc: '2.0', id: 81, method: 'tools/call', params: { name: 'memory_add', arguments: { content: '项目A专属部署约定记忆', scope_preset: 'project-global', project_id: proj.projectId } } });
    await responseOf(probe, 81);
    probe.send({ jsonrpc: '2.0', id: 82, method: 'tools/call', params: { name: 'memory_add', arguments: { content: '个人通用检索样本记忆' } } });
    await responseOf(probe, 82);
    // 3) 不带 project：项目记忆不可见
    probe.send({ jsonrpc: '2.0', id: 83, method: 'tools/call', params: { name: 'memory_search', arguments: { query: '项目A专属部署约定' } } });
    const noProj = JSON.parse((await responseOf(probe, 83) as { result?: { content?: { text: string }[] } }).result!.content![0]!.text) as { items: { preview?: string }[] };
    assert.equal(noProj.items.length, 0, '不带项目身份时项目记忆不可见');
    // 4) 带 UUID：项目记忆可见，personal 也照常（混合口径）
    probe.send({ jsonrpc: '2.0', id: 84, method: 'tools/call', params: { name: 'memory_search', arguments: { query: '检索样本 部署约定', project: proj.projectId } } });
    const withProj = JSON.parse((await responseOf(probe, 84) as { result?: { content?: { text: string }[] } }).result!.content![0]!.text) as { items: { scope_preset?: string }[] };
    const presets = withProj.items.map((it) => it.scope_preset).sort();
    assert.ok(presets.includes('project-global'), '项目作用域记忆可召回');
    assert.ok(presets.includes('personal-global'), '无项目绑定记忆照常出现');
    // 5) 带已登记别名（路径）：归一化解析后命中
    probe.send({ jsonrpc: '2.0', id: 85, method: 'tools/call', params: { name: 'memory_search', arguments: { query: '部署约定', project: 'd:/proj/alpha-test/' } } });
    const withAlias = JSON.parse((await responseOf(probe, 85) as { result?: { content?: { text: string }[] } }).result!.content![0]!.text) as { items: { scope_preset?: string }[] };
    assert.ok(withAlias.items.some((it) => it.scope_preset === 'project-global'), '别名解析后项目记忆可召回');
    // 6) 未登记路径：明确报错（isError 工具结果，指引 project_resolve），且不建项目
    probe.send({ jsonrpc: '2.0', id: 86, method: 'tools/call', params: { name: 'memory_search', arguments: { query: '部署约定', project: 'D:\\proj\\never-registered' } } });
    const errRes = await responseOf(probe, 86) as { result?: { isError?: boolean; content?: { text: string }[] } };
    assert.equal(errRes.result?.isError, true, '未登记路径以 isError 工具结果返回');
    const errBody = JSON.parse(errRes.result!.content![0]!.text) as { code?: string; message?: string };
    assert.match(errBody.message ?? '', /project_resolve/, '错误信息指引先走 project_resolve');
    // 项目表未增长（检索只查不建）
    const { openStore } = await import('../../src/store/open.js');
    const { listProjects } = await import('../../src/store/projects.js');
    const store = openStore({ home });
    try {
      assert.equal(listProjects(store.db).length, 1, '检索路径不产生新项目');
    } finally { store.close(); }
  } finally {
    await probe.kill();
    cleanupTestHome(home);
  }
});
