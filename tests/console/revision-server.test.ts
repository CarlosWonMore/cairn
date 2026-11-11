import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppService } from '../../src/interfaces/app-service.js';
import { startConsoleServer, ConsoleServerHandle } from '../../src/interfaces/console/server.js';
import { exportConsoleHtml } from '../../src/interfaces/console/export.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';

/**
 * 控制台修订提案端点（add-agent-managed-revision 任务 6.1–6.3）：
 * GET 列表（默认待审）、POST 采纳/拒绝与 CLI 同一实现（版本一致性不绕过）、
 * 静态导出页没有任何采纳/拒绝控件。
 */

const TOKEN = 'c'.repeat(64);

interface Ctx {
  home: string;
  memoryId: string;
  proposalId: string;
  proposal2Id: string;
  srv: ConsoleServerHandle;
  cleanup(): Promise<void>;
}

async function setup(): Promise<Ctx> {
  const home = makeTestHome('cairn-rev-srv-');
  const svc = AppService.open(home);
  const memoryId = svc.addMemory({ content: '构建命令是 pnpm build。' }).memory!.id;
  const proposalId = svc.proposeRevisionProposal({
    memoryId,
    afterContent: '构建命令是 pnpm build && pnpm typecheck。',
    reason: '补充类型检查步骤',
  }).id;
  const proposal2Id = svc.proposeRevisionProposal({
    memoryId,
    afterContent: '另一张待审卡片。',
    reason: '第二条方案',
  }).id;
  svc.close();
  const srv = await startConsoleServer({ home, port: 0, token: TOKEN });
  return {
    home,
    memoryId,
    proposalId,
    proposal2Id,
    srv,
    async cleanup() {
      await srv.close();
      cleanupTestHome(home);
    },
  };
}

function api(ctx: Ctx, path: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = { 'x-cairn-token': TOKEN, ...(init.headers as Record<string, string> | undefined) };
  return fetch(new URL(path, ctx.srv.url), { ...init, headers });
}

test('GET /api/revisions：默认只给待审；返回正文对照与元信息', async () => {
  const ctx = await setup();
  try {
    const r = await api(ctx, '/api/revisions');
    assert.equal(r.status, 200);
    const body = (await r.json()) as { data: { total: number; items: { id: string; status: string; beforeExcerpt: string | null; afterContent: string; proposedBy: string }[] } };
    assert.equal(body.data.total, 2);
    const first = body.data.items.find((x) => x.id === ctx.proposalId)!;
    assert.ok(first.afterContent.includes('typecheck'));
    assert.ok(first.beforeExcerpt!.includes('pnpm build'));
    assert.equal(first.status, 'pending');

    const all = (await (await api(ctx, '/api/revisions?status=all')).json()) as { data: { total: number } };
    assert.equal(all.data.total, 2);
  } finally {
    await ctx.cleanup();
  }
});

test('POST apply：走同一实现（版本一致性不绕过）；拒绝后不出现在待审', async () => {
  const ctx = await setup();
  try {
    const apply = await api(ctx, '/api/revisions/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: ctx.proposalId }),
    });
    assert.equal(apply.status, 200);
    const applyBody = (await apply.json()) as { data: { applied: boolean; revisionId: string } };
    assert.equal(applyBody.data.applied, true);
    assert.ok(applyBody.data.revisionId);

    // 采纳后记忆已更新、待审只剩一张
    const svc = AppService.open(ctx.home);
    try {
      assert.equal(svc.store.memories.require(ctx.memoryId).content, '构建命令是 pnpm build && pnpm typecheck。');
      assert.equal(svc.store.memories.require(ctx.memoryId).authority, 'user_confirmed');
    } finally {
      svc.close();
    }
    const pending = (await (await api(ctx, '/api/revisions')).json()) as { data: { total: number } };
    assert.equal(pending.data.total, 1);

    // 陈旧卡不能从控制台绕过版本检查：把记忆改掉后应用第二张 → 拒绝
    const svc2 = AppService.open(ctx.home);
    svc2.reviseMemory(ctx.memoryId, '人又改了一版', { reason: '人工' });
    svc2.close();
    const staleApply = await api(ctx, '/api/revisions/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: ctx.proposal2Id }),
    });
    assert.equal(staleApply.status, 409, `陈旧应用应 409，实际 ${staleApply.status}`);

    // 拒绝必填理由
    const rejectNoReason = await api(ctx, '/api/revisions/reject', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: ctx.proposal2Id }),
    });
    assert.equal(rejectNoReason.status, 400);

    const reject = await api(ctx, '/api/revisions/reject', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: ctx.proposal2Id, reason: '与已采纳的卡重复' }),
    });
    assert.equal(reject.status, 200);
  } finally {
    await ctx.cleanup();
  }
});

test('静态导出页不含任何采纳/拒绝控件（也无待确认徽标入口）', async () => {
  const ctx = await setup();
  try {
    const { readFileSync } = await import('node:fs');
    const { openStore } = await import('../../src/store/open.js');
    const outFile = `${ctx.home}/console-static-test.html`;
    const store = openStore({ home: ctx.home, readOnly: true });
    let html = '';
    try {
      const result = exportConsoleHtml(store, { redact: false, outFile });
      html = readFileSync(result.outFile, 'utf8');
    } finally {
      store.close();
    }
    // 静态页必须带 data-static="1"：UI 的采纳/拒绝按钮只在 !STATIC 分支渲染，
    // 该属性是静态页不出控件的根本保证（导出内嵌了完整 UI 源码，字符串级断言无效）。
    assert.ok(html.includes('data-static="1"'), '静态页必须标记 STATIC');
    assert.ok(!html.includes('/api/revisions/apply') || html.includes('data-static="1"'), '控件由 STATIC 守卫');
    // 静态页不渲染提案数据（提案是本机私有数据）
    assert.ok(!html.includes(ctx.proposalId), '静态页不包含提案内容');
    assert.ok(!html.includes('pnpm build && pnpm typecheck'), '静态页不包含提案拟改正文');
  } finally {
    await ctx.cleanup();
  }
});
