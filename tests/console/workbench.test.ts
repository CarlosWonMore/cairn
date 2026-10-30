import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openStore, CairnStore } from '../../src/store/open.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';
import { importSnapshot } from '../../src/onboarding/import.js';
import { assignBatch } from '../../src/onboarding/batches.js';
import { startConsoleServer, ConsoleServerHandle, normalizeProposedItems } from '../../src/interfaces/console/server.js';

/**
 * 工作台写链路（任务 4.6）：待处理 → 计划草稿 → 签发 → 应用。
 *
 * 与 server.test.ts 的分工：那边验边界（谁能进来），这边验流程（进来之后
 * 每一步的治理约束是否仍然成立）。全部走 HTTP，不直接调服务内部函数。
 */

const TOKEN = 'c'.repeat(64);
const CLEAN_TEXT = '生产环境数据库端口是 5433，连接超时 60 秒。';
const SECRET_TEXT = '部署凭据 AKIAIOSFODNN7EXAMPLE 需要轮换';

interface Ctx {
  home: string;
  store: CairnStore;
  batchId: string;
  blockedItemId: string;
  cleanup(): void;
}

async function setup(): Promise<Ctx> {
  const home = makeTestHome('cairn-wb-');
  const store = openStore({ home });
  const dir = join(home, 'sources');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 'notes.md');
  writeFileSync(p, [CLEAN_TEXT, SECRET_TEXT].join('\n\n'), 'utf8');
  const o = await importSnapshot(store, { agentKind: 'manual', sourcePath: p });
  const batchId = assignBatch(store, (o.archiveId ?? o.reusedArchiveId)!);
  const blocked = store.db.get("SELECT id FROM import_item WHERE batch_id = ? AND scan_state = 'blocked' LIMIT 1", batchId);
  assert.ok(blocked != null, 'fixture 必须包含一条被拦截条目');
  store.close();
  const readOnly = openStore({ home, readOnly: true });
  return {
    home,
    store: readOnly,
    batchId,
    blockedItemId: String(blocked!['id']),
    cleanup() {
      try {
        readOnly.close();
      } catch {
        /* 已关闭 */
      }
      cleanupTestHome(home);
    },
  };
}

async function serve(ctx: Ctx): Promise<ConsoleServerHandle> {
  return startConsoleServer({ home: ctx.home, port: 0, token: TOKEN });
}

function call(srv: ConsoleServerHandle, path: string, body?: unknown): Promise<Response> {
  return fetch(new URL(path, srv.url), {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-cairn-token': TOKEN, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

type Json = { ok: boolean; data: any; error?: { code: string; message: string } };

test('待处理队列：必须人判断与可批量确认分两组，且 needs_human 排最前', async () => {
  const ctx = await setup();
  const srv = await serve(ctx);
  try {
    const r = (await (await call(srv, '/api/inbox?limit=200')).json()) as Json;
    assert.equal(r.ok, true);
    const inbox = r.data;
    assert.ok(inbox.entries.length >= 1);
    assert.equal(inbox.counts.decisionRequired + inbox.counts.bulkConfirmable, inbox.entries.length);

    const needIdx = inbox.entries.findIndex((e: any) => e.decisionRequired);
    const bulkIdx = inbox.entries.findIndex((e: any) => !e.decisionRequired);
    if (needIdx >= 0 && bulkIdx >= 0) {
      assert.ok(needIdx < bulkIdx || inbox.entries[needIdx].priority <= inbox.entries[bulkIdx].priority);
    }
    for (const e of inbox.entries) {
      if (e.decisionRequired) {
        assert.ok(
          e.action === 'needs_human' || e.conflict === true || e.action === 'merge',
          `必须人判断的条目应带可解释理由，实际 action=${e.action}`,
        );
      }
    }
  } finally {
    await srv.close();
    ctx.cleanup();
  }
});

test('计划草稿：页面只给 itemId + 动作，正文由服务端按条目回填', async () => {
  const ctx = await setup();
  const srv = await serve(ctx);
  try {
    // 页面提交的形状：opType（面向人的词）+ content: null（摘要模式下根本没有全文）
    const r = (await (
      await call(srv, '/api/plans', {
        batchId: ctx.batchId,
        items: [{ itemId: (await firstCleanItem(ctx))!, opType: 'promote', reason: 'webui 采纳：S-CLEAN-DEFAULT' }],
      })
    ).json()) as Json;
    assert.equal(r.ok, true, JSON.stringify(r.error));
    assert.equal(r.data.plan.itemCount, 1);
    assert.ok(r.data.plan.planHash.length >= 32);

    const op = ctx.store.db.get('SELECT op_type, content_hash FROM plan_operation WHERE plan_id = ?', r.data.plan.id);
    assert.equal(String(op!['op_type']), 'add', 'promote 必须被翻译成计划层的 add');
  } finally {
    await srv.close();
    ctx.cleanup();
  }
});

test('计划草稿：blocked 条目被拒且说明原文未入库', async () => {
  const ctx = await setup();
  const srv = await serve(ctx);
  try {
    const r = (await (
      await call(srv, '/api/plans', { batchId: ctx.batchId, items: [{ itemId: ctx.blockedItemId, opType: 'promote' }] })
    ).json()) as Json;
    assert.equal(r.ok, false);
    assert.equal(r.error!.code, 'E_VALIDATION');
    assert.ok(r.error!.message.includes('原文未入库'), r.error!.message);
  } finally {
    await srv.close();
    ctx.cleanup();
  }
});

test('治理链：未签发不可应用 → 签发后应用成功 → 重复应用幂等', async () => {
  const ctx = await setup();
  const srv = await serve(ctx);
  try {
    const created = (await (
      await call(srv, '/api/plans', {
        batchId: ctx.batchId,
        items: [{ itemId: (await firstCleanItem(ctx))!, opType: 'promote', reason: 'webui 采纳' }],
      })
    ).json()) as Json;
    const planId = created.data.plan.id as string;
    const hash = created.data.planHash as string;

    // 1. 没有审批就应用：必须被治理层挡住（不是前端挡）
    const before = (await (await call(srv, `/api/plans/${encodeURIComponent(planId)}/apply`, { approvalId: 'fake' })).json()) as Json;
    assert.equal(before.ok, false);
    assert.equal(before.error!.code, 'E_APPROVAL_INVALID', '伪造审批必须被识别为无效');

    // 2. 签发
    const approved = (await (
      await call(srv, `/api/plans/${encodeURIComponent(planId)}/approve`, { planHashPrefix: hash.slice(0, 8) })
    ).json()) as Json;
    assert.equal(approved.ok, true, JSON.stringify(approved.error));
    const approvalId = approved.data.approvalId as string;

    // 3. 应用
    const applied = (await (
      await call(srv, `/api/plans/${encodeURIComponent(planId)}/apply`, { approvalId })
    ).json()) as Json;
    assert.equal(applied.ok, true, JSON.stringify(applied.error));
    const mem = ctx.store.db.scalar('SELECT COUNT(*) AS n FROM memory WHERE content = ?', CLEAN_TEXT);
    assert.equal(Number(mem), 1, '应用后记忆应落库');

    // 4. 幂等而非报错：apply 是崩溃重试的恢复路径，重复调用必须是空操作
    const again = (await (
      await call(srv, `/api/plans/${encodeURIComponent(planId)}/apply`, { approvalId })
    ).json()) as Json;
    assert.equal(again.ok, true, '重复应用按幂等处理，不抛错');
    assert.equal(again.data.report.alreadyApplied, true);
    assert.equal(again.data.report.applied, 0, '不得产生新的副作用');
    const memAfter = ctx.store.db.scalar('SELECT COUNT(*) AS n FROM memory WHERE content = ?', CLEAN_TEXT);
    assert.equal(Number(memAfter), 1, '记忆不得被复制成两条');
  } finally {
    await srv.close();
    ctx.cleanup();
  }
});

test('审批与计划绑定：A 的审批不能用来应用 B', async () => {
  const ctx = await setup();
  const srv = await serve(ctx);
  try {
    const itemId = (await firstCleanItem(ctx))!;
    const a = (await (
      await call(srv, '/api/plans', { batchId: ctx.batchId, items: [{ itemId, opType: 'promote' }] })
    ).json()) as Json;
    const b = (await (
      await call(srv, '/api/plans', { batchId: ctx.batchId, items: [{ itemId, opType: 'keep_both' }] })
    ).json()) as Json;
    assert.notEqual(a.data.plan.id, b.data.plan.id, '两次提交应产生两个独立计划');

    const approvedA = (await (
      await call(srv, `/api/plans/${encodeURIComponent(a.data.plan.id)}/approve`, {
        planHashPrefix: (a.data.planHash as string).slice(0, 8),
      })
    ).json()) as Json;
    assert.equal(approvedA.ok, true);

    const cross = (await (
      await call(srv, `/api/plans/${encodeURIComponent(b.data.plan.id)}/apply`, {
        approvalId: approvedA.data.approvalId,
      })
    ).json()) as Json;
    assert.equal(cross.ok, false, '跨计划复用审批必须被拒');
    assert.equal(cross.error!.code, 'E_APPROVAL_INVALID');

    // 全流程结束后不能再签一次：计划状态已不再 awaiting_approval
    const applied = (await (
      await call(srv, `/api/plans/${encodeURIComponent(a.data.plan.id)}/apply`, {
        approvalId: approvedA.data.approvalId,
      })
    ).json()) as Json;
    assert.equal(applied.ok, true);
    const reApprove = (await (
      await call(srv, `/api/plans/${encodeURIComponent(a.data.plan.id)}/approve`, {
        planHashPrefix: (a.data.planHash as string).slice(0, 8),
      })
    ).json()) as Json;
    assert.equal(reApprove.ok, false, '已应用的计划不得再次签发');
  } finally {
    await srv.close();
    ctx.cleanup();
  }
});

test('normalizeProposedItems：缺 itemId 且无正文 → 拒绝，不猜', () => {
  const store = { db: { get: () => undefined } } as unknown as CairnStore;
  assert.throws(() => normalizeProposedItems(store, [{ opType: 'promote' }]), /缺少 itemId/);
});

test('normalizeProposedItems：正文显式给出时不再查库（供 CLI/MCP 复用）', () => {
  const store = { db: { get: () => { throw new Error('不应查库'); } } } as unknown as CairnStore;
  const out = normalizeProposedItems(store, [{ content: '一条完整的正文', kind: 'fact', opHint: 'add' }]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.content, '一条完整的正文');
  assert.equal(out[0]!.opHint, 'add');
});

async function firstCleanItem(ctx: Ctx): Promise<string | null> {
  const row = ctx.store.db.get("SELECT id FROM import_item WHERE batch_id = ? AND scan_state = 'clean' LIMIT 1", ctx.batchId);
  return row == null ? null : String(row['id']);
}
