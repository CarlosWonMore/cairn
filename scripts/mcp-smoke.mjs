#!/usr/bin/env node
/**
 * Cairn MCP 冒烟（宿主接入自检）
 *
 * 默认只读：对真实 HOME（~/.cairn）只做 initialize / tools/list / memory_search，
 * 不写入任何内容，可安全地在日常环境反复运行。
 *
 * 用法：
 *   node scripts/mcp-smoke.mjs                  # 只读冒烟，真实 HOME
 *   node scripts/mcp-smoke.mjs --home <dir>     # 指定库目录
 *   node scripts/mcp-smoke.mjs --write --home <dir>
 *                                               # 追加写入往返（add/search/update/forget），
 *                                               # 必须显式给 --home，避免污染真实库
 *   node scripts/mcp-smoke.mjs --json           # 输出单行 JSON 摘要（供自动化采集）
 *
 * 退出码：0 全部通过；1 有步骤失败；2 用法/环境错误（未构建、拒绝写真实库）。
 *
 * 注意：本脚本不使用 process.exit() 提前退出——早期版本在 finally 里直接
 * process.exit(0) 会把异常吞掉，导致「零输出 + 退出码 0」的假绿。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const hasFlag = (name) => argv.includes(name);
const optVal = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};

const quiet = hasFlag('--json');
const wantWrite = hasFlag('--write');
const realHome = join(homedir(), '.cairn');
const home = resolve(optVal('--home', realHome));
const query = optVal('--query', 'MCP');
const serverPath = join(repoRoot, 'dist', 'src', 'interfaces', 'mcp', 'server.js');

const steps = [];
const log = (...a) => {
  if (!quiet) console.log(...a);
};
const record = (step, ok, extra = {}) => {
  steps.push({ step, ok, ...extra });
  log(`${ok ? 'PASS' : 'FAIL'}  ${step}${Object.keys(extra).length ? '  ' + JSON.stringify(extra) : ''}`);
  return ok;
};

let finalized = false;
function finish(exitCode) {
  if (finalized) return;
  finalized = true;
  const failed = steps.filter((s) => !s.ok);
  const ok = exitCode === 0 && failed.length === 0;
  if (quiet) {
    console.log(JSON.stringify({ home, mode: wantWrite ? 'read-write' : 'read-only', query, ok, steps }));
  } else {
    console.log('');
    console.log(`${steps.length} 步，通过 ${steps.length - failed.length}，失败 ${failed.length} → ${ok ? 'MCP_SMOKE_OK' : 'MCP_SMOKE_FAIL'}`);
    if (failed.length > 0) console.log('失败步骤：' + failed.map((s) => s.step).join('；'));
  }
  process.exitCode = ok ? 0 : exitCode === 0 ? 1 : exitCode;
}

const fatal = (message) => {
  steps.push({ step: '环境检查', ok: false, error: message });
  log(`FAIL  环境检查  ${message}`);
  finish(2);
};

if (!existsSync(serverPath)) {
  fatal(`找不到 ${serverPath}，先运行 npm run build`);
} else if (wantWrite && home === realHome && !hasFlag('--allow-real-write')) {
  fatal(`拒绝向真实库 ${realHome} 写入：请用 --home <临时目录>，或显式 --allow-real-write`);
} else {
  run();
}

async function run() {
  const proc = spawn(process.execPath, [serverPath, '--home', home], { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  proc.stdout.on('data', (c) => (out += String(c)));
  proc.stderr.on('data', (c) => (err += String(c)));
  proc.on('error', (e) => record('启动 MCP 服务器', false, { error: String(e?.message ?? e) }));

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tail = (s, n = 4) =>
    s
      .replace(/\r/g, '')
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .slice(-n)
      .join(' | ');
  const send = (obj) => proc.stdin.write(JSON.stringify(obj) + '\n');
  const parsedLines = () =>
    out
      .split('\n')
      .filter(Boolean)
      .map((raw) => {
        try {
          return { raw, json: JSON.parse(raw) };
        } catch {
          return { raw, json: null };
        }
      });

  let seq = 0;
  async function request(method, params, timeoutMs = 20000) {
    const id = ++seq;
    send({ jsonrpc: '2.0', id, method, params });
    const start = Date.now();
    for (;;) {
      const hit = parsedLines().find((l) => l.json && l.json.id === id);
      if (hit) return hit.json;
      if (proc.exitCode !== null) throw new Error(`等待 id=${id} 时服务器退出（code=${proc.exitCode}）；stderr=${tail(err)}`);
      if (Date.now() - start > timeoutMs) throw new Error(`等待 id=${id}(${method}) 超时；stderr=${tail(err)}`);
      await sleep(40);
    }
  }

  async function tool(name, args) {
    const r = await request('tools/call', { name, arguments: args });
    const text = r.result?.content?.[0]?.text;
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* 非 JSON 工具结果由调用方按 isError 判定 */
    }
    return { isError: r.result?.isError ?? null, body, text };
  }

  // items 是真实字段；早期脚本按 results 取值，恒为 undefined 导致假绿
  const itemsOf = (body) => (Array.isArray(body?.items) ? body.items : Array.isArray(body?.results) ? body.results : null);
  const idOf = (x) => x?.id ?? x?.memory?.id;

  try {
    const startWait = Date.now();
    while (!err.includes('stdio server ready')) {
      if (proc.exitCode !== null) throw new Error(`服务器提前退出（code=${proc.exitCode}）；stderr=${tail(err)}`);
      if (Date.now() - startWait > 20000) throw new Error(`等待就绪超时；stderr=${tail(err)}`);
      await sleep(20);
    }

    const init = await request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'cairn-mcp-smoke', version: '1' },
    });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const info = init.result?.serverInfo ?? {};
    record('initialize', info.name === 'cairn', { server: info.name, version: info.version });

    const list = await request('tools/list', {});
    const names = (list.result?.tools ?? []).map((t) => t.name);
    const expected = ['memory_add', 'memory_context', 'memory_forget', 'memory_get', 'memory_propose', 'memory_search', 'memory_status', 'memory_update'];
    const missing = expected.filter((t) => !names.includes(t));
    record('tools/list 核心 8 工具齐全', missing.length === 0, { count: names.length, missing });

    const search = await tool('memory_search', { query });
    const items = itemsOf(search.body);
    record('memory_search 返回结构可解析', !search.isError && Array.isArray(items), {
      hits: items ? items.length : null,
      matchedBy: search.body?.matchedBy,
    });

    const firstId = idOf(items?.[0]);
    if (firstId) {
      const got = await tool('memory_get', { id: firstId });
      record('memory_get 命中首条', !got.isError && Boolean(idOf(got.body) ?? got.body?.id), {});
    }

    const ctx = await tool('memory_context', {});
    record('memory_context 可用', !ctx.isError && Array.isArray(ctx.body?.items), { items: ctx.body?.items?.length ?? null });

    const status = await tool('memory_status', {});
    record('memory_status 可用', !status.isError && Boolean(status.body?.memories), { device: status.body?.device });

    if (wantWrite) {
      const token = `smoke-${Date.now().toString(36)}`;
      const added = await tool('memory_add', { content: `冒烟写入探针 ${token}`, kind: 'fact' });
      const memId = added.body?.id ?? added.body?.memory?.id;
      record('memory_add', !added.isError && Boolean(memId), { id: memId });

      const found = itemsOf((await tool('memory_search', { query: token })).body) ?? [];
      record('写入后可检索', found.some((x) => idOf(x) === memId), { hits: found.length });

      const updated = await tool('memory_update', { id: memId, content: `冒烟写入探针（已更正）${token}`, reason: 'smoke' });
      record('memory_update 生成新修订', !updated.isError && Boolean(updated.body?.revisionId), { revisionId: updated.body?.revisionId });

      const forgotten = await tool('memory_forget', { id: memId, reason: 'smoke 清理' });
      record('memory_forget 生成墓碑', !forgotten.isError && forgotten.body?.status === 'tombstoned', { status: forgotten.body?.status });

      const after = itemsOf((await tool('memory_search', { query: token })).body) ?? [];
      record('遗忘后检索归零', !after.some((x) => idOf(x) === memId), { remaining: after.length });
    }

    const bad = parsedLines().filter((l) => l.json === null);
    record('stdout 仅 JSON-RPC', bad.length === 0, { nonJsonLines: bad.length, sample: bad[0]?.raw?.slice(0, 80) });
  } catch (e) {
    record('冒烟执行', false, { error: String(e?.message ?? e).slice(0, 300) });
  } finally {
    if (proc.exitCode === null) {
      const closed = new Promise((r) => proc.once('close', r));
      proc.kill();
      await Promise.race([closed, sleep(3000)]);
    }
    finish(0);
  }
}
