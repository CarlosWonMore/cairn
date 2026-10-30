import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTestHome, cleanupTestHome } from '../helpers.js';
import { mcpServerEntry, cliEntry } from '../spawn-target.js';
import { openStore } from '../../src/store/open.js';
import { reviewSubmit } from '../../src/interfaces/console/review-store.js';
import { exitCodeFor } from '../../src/core/errors.js';

/**
 * `review` 的三条通道必须共用同一套校验（任务 3.5）：
 * CLI（`cairn review submit`）、控制台（`POST /api/reviews/import`）、MCP（`memory_review`）。
 *
 * 这里不逐条复述校验规则，而是拿**同一份非法输入**分别喂给三条通道，
 * 断言它们落在同一个拒绝码上。规则改一次，三处一起变或一起红。
 */

const CLEAN_TEXT = '生产环境数据库端口是 5433，连接超时 60 秒。';

interface Fixture {
  home: string;
  cleanup(): void;
}

async function seeded(): Promise<Fixture> {
  const home = makeTestHome('cairn-review-cli-');
  const store = openStore({ home });
  const dir = join(home, 'sources');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 'one.md');
  writeFileSync(p, CLEAN_TEXT + '\n', 'utf8');
  const { importSnapshot } = await import('../../src/onboarding/import.js');
  const { assignBatch } = await import('../../src/onboarding/batches.js');
  const o = await importSnapshot(store, { agentKind: 'manual', sourcePath: p });
  assignBatch(store, (o.archiveId ?? o.reusedArchiveId)!);
  store.close();
  return { home, cleanup: () => cleanupTestHome(home) };
}

function firstItemId(home: string): string {
  const store = openStore({ home, readOnly: true });
  const row = store.db.get("SELECT id FROM import_item WHERE scan_state = 'clean' LIMIT 1");
  store.close();
  return String(row!['id']);
}

/** 最小 MCP 客户端：一进一出，够用来断言工具返回。 */
function mcpCall(home: string, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; payload: any }> {
  const target = mcpServerEntry();
  return new Promise((resolve, reject) => {
    const p: ChildProcess = spawn(process.execPath, [...target.loader, target.file, '--home', home], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let buf = '';
    let sent = false;
    const timer = setTimeout(() => {
      p.kill();
      reject(new Error(`MCP 超时，已收到: ${buf}`));
    }, 30_000);
    const finish = (r: { isError: boolean; payload: any }): void => {
      clearTimeout(timer);
      p.kill();
      resolve(r);
    };
    p.stdout!.on('data', (c) => {
      buf += c;
      for (const line of buf.split('\n')) {
        if (!line.trim().startsWith('{')) continue;
        let msg: any;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id === 2) {
          const result = msg.result ?? {};
          const text = result.content?.[0]?.text ?? '{}';
          finish({ isError: result.isError === true, payload: JSON.parse(text) });
          return;
        }
        if (msg.id === 1 && !sent) {
          sent = true;
          p.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }) + '\n');
        }
      }
    });
    p.on('error', reject);
    p.stdin!.write(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }) + '\n',
    );
  });
}

test('MCP memory_review：pack 产出复核包并报告字符量', async () => {
  const f = await seeded();
  try {
    const r = await mcpCall(f.home, 'memory_review', { action: 'pack', out_file: join(f.home, 'pack.json') });
    assert.equal(r.isError, false, JSON.stringify(r.payload));
    assert.ok(r.payload.itemCount >= 1);
    assert.ok(r.payload.totalChars > 0);
    assert.ok(String(r.payload.note).includes('本地审批'), '必须说明建议不等于晋升');
  } finally {
    f.cleanup();
  }
});

test('三条通道对同一非法输入返回同一拒绝码', async () => {
  const f = await seeded();
  try {
    const itemId = firstItemId(f.home);
    const bad = [
      { itemId, action: 'promote', reason: '合法的一条' },
      { itemId: 'item-not-exist', action: 'promote', reason: '指向不存在的条目' },
    ];

    // 1. 共享实现（CLI 与 HTTP 直接调用的就是它）
    const store = openStore({ home: f.home });
    let sharedCode = 'NO_ERROR';
    let sharedMessage = '';
    try {
      reviewSubmit(store, { items: bad, producer: 'test' });
    } catch (e) {
      sharedCode = String((e as { code?: string }).code);
      sharedMessage = String((e as Error).message);
    }
    store.close();
    assert.equal(sharedCode, 'E_VALIDATION');
    assert.equal(exitCodeFor(sharedCode as never), 2, 'CLI 退出码由同一条映射决定');

    // 2. MCP
    const mcp = await mcpCall(f.home, 'memory_review', { action: 'submit', items: bad });
    assert.equal(mcp.isError, true, 'MCP 应以 isError 返回治理拒绝');
    assert.equal(mcp.payload.code, sharedCode, 'MCP 与共享实现必须是同一拒绝码');

    // 3. CLI
    const cliFile = join(f.home, 'bad.json');
    writeFileSync(cliFile, JSON.stringify({ items: bad }), 'utf8');
    const target = cliEntry();
    const cli = await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
      const p = spawn(process.execPath, [...target.loader, target.file, '--home', f.home, 'review', 'submit', '--input', cliFile], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      p.stderr.on('data', (c) => (stderr += c));
      p.on('error', reject);
      p.on('close', (code) => resolve({ code, stderr }));
    });
    assert.equal(cli.code, 2, `CLI 应以 2 退出，实际 ${cli.code}：${cli.stderr}`);
    assert.ok(cli.stderr.includes('整批拒绝'), cli.stderr);

    // 三处都没写进任何东西
    const after = openStore({ home: f.home, readOnly: true });
    const n = Number(after.db.scalar('SELECT COUNT(*) AS n FROM audit_event WHERE category = ?', 'review') ?? 0);
    after.close();
    assert.equal(n, 0, '整批拒绝不得留下部分写入');
    assert.ok(sharedMessage.length > 0);
  } finally {
    f.cleanup();
  }
});

test('MCP memory_review：未知 action 明确报错而不是静默成功', async () => {
  const f = await seeded();
  try {
    const r = await mcpCall(f.home, 'memory_review', { action: '随便写一个' });
    assert.equal(r.isError, true);
    assert.equal(r.payload.code, 'E_VALIDATION');
    assert.ok(String(r.payload.message).includes('pack'), r.payload.message);
  } finally {
    f.cleanup();
  }
});

test('MCP memory_review：list 在未写回时返回空数组', async () => {
  const f = await seeded();
  try {
    const r = await mcpCall(f.home, 'memory_review', { action: 'list' });
    assert.equal(r.isError, false);
    assert.deepEqual(r.payload, []);
  } finally {
    f.cleanup();
  }
});
