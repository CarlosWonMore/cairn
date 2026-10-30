import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openStore } from '../../src/store/index.js';
import type { CairnStore } from '../../src/store/index.js';
import { importSnapshot } from '../../src/onboarding/import.js';
import { assignBatch } from '../../src/onboarding/batches.js';
import { policyPath, signPolicy } from '../../src/onboarding/policy.js';
import { revokeByPolicy, runAutoOnboarding } from '../../src/onboarding/auto.js';
import { reviewSubmit } from '../../src/interfaces/console/review-store.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';

const NOTES = [
  '生产环境数据库端口是 5433，连接超时 60 秒。',
  '构建命令是 pnpm build，产物目录是 dist。',
  '发布流程第一步是冻结主干分支。',
].join('\n\n');

interface Ctx {
  home: string;
  store: CairnStore;
  batchId: string;
  cleanup(): void;
}

async function setup(content = NOTES): Promise<Ctx> {
  const home = makeTestHome('cairn-auto-');
  const store = openStore({ home });
  const dir = join(home, 'src');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'notes.md');
  writeFileSync(file, content, 'utf8');
  const out = await importSnapshot(store, { agentKind: 'manual', sourcePath: file });
  const archiveId = (out.archiveId ?? out.reusedArchiveId)!;
  const batchId = assignBatch(store, archiveId);
  return {
    home,
    store,
    batchId,
    cleanup() {
      store.close();
      cleanupTestHome(home);
    },
  };
}

const BASE_POLICY = {
  id: 'test-auto',
  allowedScopes: ['personal-global'],
  maxSensitivity: 'normal' as const,
  requireAiAgreement: false,
  allowCreate: true,
  minConfidence: 0.6,
  note: '测试用',
};

function sign(ctx: Ctx, over: Record<string, unknown> = {}) {
  return signPolicy(ctx.home, { ...BASE_POLICY, ...over }, { via: 'cli' });
}

function memoryCount(store: CairnStore, where = '1=1'): number {
  return Number(store.db.get(`SELECT count(*) AS n FROM memory WHERE ${where}`)!.n);
}

test('全条件满足：按策略自动应用，汇总可自校验', async () => {
  const ctx = await setup();
  try {
    sign(ctx);
    const s = runAutoOnboarding(ctx.store, { policyId: 'test-auto' });
    assert.ok(s.applied >= 1, `应至少应用一条，实际 ${s.applied}`);
    assert.equal(s.balanced, true, `汇总不平：applied=${s.applied} skipped=${s.skipped} failed=${s.failed} manual=${s.manual} total=${s.totalItems}`);
    assert.equal(s.auto + s.manual, s.totalItems);
    assert.ok(memoryCount(ctx.store, "status='active'") >= 1);
    assert.ok(s.plans.length >= 1);
    assert.ok(s.plans[0]!.approvalId.length > 0, '自动应用必须签发审批');
  } finally {
    ctx.cleanup();
  }
});

test('dry-run：只分档不写库', async () => {
  const ctx = await setup();
  try {
    sign(ctx);
    const s = runAutoOnboarding(ctx.store, { policyId: 'test-auto', dryRun: true });
    assert.equal(s.applied, 0);
    assert.equal(s.plans.length, 0);
    assert.equal(memoryCount(ctx.store), 0, 'dry-run 不得写任何记忆');
    assert.equal(s.balanced, true);
    assert.ok(s.auto > 0, '分档结果仍要给出');
  } finally {
    ctx.cleanup();
  }
});

test('未签发策略：拒绝运行', async () => {
  const ctx = await setup();
  try {
    assert.throws(() => runAutoOnboarding(ctx.store, { policyId: 'nope' }), /策略不存在|E_NOT_FOUND/);
    assert.equal(memoryCount(ctx.store), 0);
  } finally {
    ctx.cleanup();
  }
});

test('策略文件被改动后运行被拒，不降级使用', async () => {
  const ctx = await setup();
  try {
    sign(ctx);
    const file = policyPath(ctx.home, 'test-auto');
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    (parsed['spec'] as Record<string, unknown>)['allowCreate'] = true;
    (parsed['spec'] as Record<string, unknown>)['minConfidence'] = 0;
    writeFileSync(file, JSON.stringify(parsed), 'utf8');
    assert.throws(() => runAutoOnboarding(ctx.store, { policyId: 'test-auto' }), /哈希不一致|重新签发/);
    assert.equal(memoryCount(ctx.store), 0, '被拒的策略不得产生任何记忆');
  } finally {
    ctx.cleanup();
  }
});

test('目标作用域不在策略白名单：拒绝运行', async () => {
  const ctx = await setup();
  try {
    sign(ctx, { allowedScopes: ['device-local'] });
    assert.throws(
      () => runAutoOnboarding(ctx.store, { policyId: 'test-auto' }),
      /不在策略|允许集|E_FORBIDDEN/,
    );
    assert.equal(memoryCount(ctx.store), 0);
  } finally {
    ctx.cleanup();
  }
});

test('allowCreate=false：不新建，需创建的转人工，汇总仍平', async () => {
  const ctx = await setup();
  try {
    sign(ctx, { allowCreate: false });
    const s = runAutoOnboarding(ctx.store, { policyId: 'test-auto' });
    assert.equal(s.applied, 0);
    assert.equal(memoryCount(ctx.store), 0);
    assert.equal(s.balanced, true);
    assert.ok((s.byCondition['create'] ?? 0) > 0, '未满足条件应被计数');
    // 规则层已判 skip 的条目不需要"新建许可"，仍可自动确认——这不是漏判。
    for (const t of s.tiers.filter((x) => x.tier === 'auto')) {
      assert.equal(t.action, 'skip', `auto 档只应剩 skip，实际 ${t.action}`);
    }
    assert.equal(s.auto + s.manual, s.totalItems);
  } finally {
    ctx.cleanup();
  }
});

test('两层不一致：转人工并指出条件，不二选一', async () => {
  const ctx = await setup();
  try {
    sign(ctx, { requireAiAgreement: true });
    const items = ctx.store.db.all("SELECT id FROM import_item WHERE batch_id = ? AND scan_state = 'clean'", ctx.batchId);
    const first = String(items[0]!.id);
    reviewSubmit(ctx.store, {
      producer: 'test',
      items: [{ itemId: first, action: 'skip', reason: '与既有条目表述重复', confidence: 'high' }],
    });
    const s = runAutoOnboarding(ctx.store, { policyId: 'test-auto' });
    const entry = s.tiers.find((t) => t.itemId === first)!;
    assert.equal(entry.tier, 'manual');
    assert.equal(entry.failedCondition, 'ai_agreement');
    assert.equal(s.balanced, true);
  } finally {
    ctx.cleanup();
  }
});

test('同批三段完全相同的正文：应用后只有一条记忆', async () => {
  const dup = '团队约定：提交前必须本地跑一遍全量测试。';
  const ctx = await setup([dup, dup, dup, '另一条独立的事实：产物目录是 dist。'].join('\n\n'));
  try {
    sign(ctx);
    const s = runAutoOnboarding(ctx.store, { policyId: 'test-auto' });
    assert.equal(s.balanced, true);
    const rows = ctx.store.db.all("SELECT content FROM memory WHERE status = 'active'");
    const same = rows.filter((r) => String(r.content).replace(/\s+/g, ' ').trim() === dup).length;
    assert.equal(same, 1, `重复正文应只留一条，实际 ${same}`);
  } finally {
    ctx.cleanup();
  }
});

test('审计强制携带策略标识与哈希前缀', async () => {
  const ctx = await setup();
  try {
    const signed = sign(ctx);
    runAutoOnboarding(ctx.store, { policyId: 'test-auto' });
    const row = ctx.store.db.get(
      "SELECT detail FROM audit_event WHERE category='policy' AND action='auto_applied' ORDER BY at DESC LIMIT 1",
    );
    assert.ok(row, '必须有 auto_applied 审计');
    const d = JSON.parse(String(row!.detail)) as Record<string, unknown>;
    assert.equal(d['policyId'], 'test-auto');
    assert.equal(d['policyHashPrefix'], signed.policyHash.slice(0, 8));
    assert.equal(d['batchId'], ctx.batchId);
    assert.ok(Array.isArray(d['memoryIds']), '要能定位到具体记忆，撤销才有依据');
  } finally {
    ctx.cleanup();
  }
});

test('自动签发走 policy 通道，审计可读出通道', async () => {
  const ctx = await setup();
  try {
    const signed = sign(ctx);
    const s = runAutoOnboarding(ctx.store, { policyId: 'test-auto' });
    const planId = s.plans[0]!.planId;
    const approval = ctx.store.db.get('SELECT channel, approved_by FROM approval WHERE plan_id = ?', planId);
    assert.ok(approval);
    assert.equal(String(approval!.approved_by), 'local_cli', '不新增 approved_by 枚举值');
    assert.equal(String(approval!.channel), `policy:test-auto:${signed.policyHash.slice(0, 8)}`);
  } finally {
    ctx.cleanup();
  }
});

test('按策略撤销：转 tombstone，同一批次可重新整理', async () => {
  const ctx = await setup();
  try {
    sign(ctx);
    const first = runAutoOnboarding(ctx.store, { policyId: 'test-auto' });
    const activeBefore = memoryCount(ctx.store, "status='active'");
    assert.ok(activeBefore >= 1);

    const revoked = revokeByPolicy(ctx.store, 'test-auto', { batchId: ctx.batchId });
    assert.ok(revoked.tombstoned >= 1);
    assert.equal(memoryCount(ctx.store, "status='active'"), 0, '撤销后不应还有 active');
    assert.equal(memoryCount(ctx.store, "status='tombstoned'"), activeBefore, '不物理删除，留墓碑');

    // 重新整理：已晋升的默认被跳过（规则层判 skip 的条目仍会被选中，但它们本来就不写东西），
    // 撤销后要真正重做必须显式 redo。
    const skipped = runAutoOnboarding(ctx.store, { policyId: 'test-auto' });
    assert.equal(skipped.applied, 0, '已处理过的条目默认不再应用');
    assert.equal(memoryCount(ctx.store, "status='active'"), 0, '默认重跑不得复活记忆');
    const second = runAutoOnboarding(ctx.store, { policyId: 'test-auto', redo: true });
    assert.ok(second.applied >= 1, `重新整理应能再次应用，实际 applied=${second.applied}`);
    assert.equal(second.balanced, true);
  } finally {
    ctx.cleanup();
  }
});

test('撤销只影响指定批次', async () => {
  const ctx = await setup();
  try {
    sign(ctx);
    runAutoOnboarding(ctx.store, { policyId: 'test-auto' });
    const before = memoryCount(ctx.store, "status='active'");
    const revoked = revokeByPolicy(ctx.store, 'test-auto', { batchId: 'other-batch' });
    assert.equal(revoked.tombstoned, 0);
    assert.equal(memoryCount(ctx.store, "status='active'"), before);
  } finally {
    ctx.cleanup();
  }
});

test('点名指定条目视为显式重做：已晋升的条目也要重新应用', async () => {
  const ctx = await setup();
  try {
    sign(ctx);
    const first = runAutoOnboarding(ctx.store, { policyId: 'test-auto' });
    assert.ok(first.applied >= 1, '先跑一轮，制造已晋升状态');
    // 从批次里取一条必然存在的条目，避免依赖 plans 的形状变化。
    const anyItem = ctx.store.db.get('SELECT id FROM import_item WHERE batch_id = ? ORDER BY id LIMIT 1', ctx.batchId);
    const itemId = String(anyItem!.id);
    assert.ok(itemId.length > 0);
    const before = memoryCount(ctx.store, "status='active'");

    const again = runAutoOnboarding(ctx.store, { policyId: 'test-auto', itemIds: [itemId] });
    // 点名的条目必须真的被判过（不是被"已晋升"静默过滤后当成"不属于批次"报错）。
    assert.equal(again.totalItems, 1, `应只处理点名的 1 条，实际 ${again.totalItems}`);
    assert.equal(again.balanced, true);
    assert.equal(again.auto + again.manual, 1);
    assert.ok(memoryCount(ctx.store, "status='active'") >= before, '重做不应减少记忆');
  } finally {
    ctx.cleanup();
  }
});