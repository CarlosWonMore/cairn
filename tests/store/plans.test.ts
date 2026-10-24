import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore, CairnStore } from '../../src/store/open.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';
import { canonicalizePlan, PlanOpInput } from '../../src/store/plans.js';
import { sha256Canonical, contentHash } from '../../src/core/hash.js';

function withStore(fn: (store: CairnStore) => void): void {
  const home = makeTestHome();
  const store = openStore({ home });
  try {
    fn(store);
  } finally {
    store.close();
    cleanupTestHome(home);
  }
}

function sampleOps(): PlanOpInput[] {
  return [
    { opType: 'add', content: '构建命令是 pnpm build', kind: 'fact' },
    { opType: 'add', content: '用户偏好中文', kind: 'preference' },
    { opType: 'skip', reason: '无信息量' },
  ];
}

test('计划：plan_hash 稳定（顺序无关）且可复现', () => {
  withStore((store) => {
    const scope = store.scopes.resolvePreset('personal-global');
    const { plan, planHash } = store.plans.createPlan({
      scopeId: scope.id,
      ops: sampleOps(),
      proposedBy: 'agent:test',
      sourceArchiveIds: ['arc-b', 'arc-a'],
    });
    assert.equal(plan.status, 'awaiting_approval');
    assert.equal(planHash, plan.planHash);
    assert.equal(plan.itemCount, 3);

    // 同一内容不同顺序 → 相同规范化哈希
    const canonicalA = canonicalizePlan({ scopeId: scope.id, sourceArchiveIds: ['arc-b', 'arc-a'], ops: sampleOps(), hashContent: (c) => sha256Canonical({ content: c }) });
    const canonicalB = canonicalizePlan({ scopeId: scope.id, sourceArchiveIds: ['arc-a', 'arc-b'], ops: [...sampleOps()].reverse(), hashContent: (c) => sha256Canonical({ content: c }) });
    assert.equal(sha256Canonical(canonicalA), sha256Canonical(canonicalB), '来源数组与操作顺序不影响规范化哈希');
    assert.equal(plan.planHash, sha256Canonical(canonicalA));
  });
});

test('计划：内容/作用域变化 → 哈希变化（篡改可检测）', () => {
  withStore((store) => {
    const scope = store.scopes.resolvePreset('personal-global');
    const h = (ops: PlanOpInput[], scopeId = scope.id) =>
      sha256Canonical(canonicalizePlan({ scopeId, sourceArchiveIds: [], ops, hashContent: (c) => sha256Canonical({ content: c }) }));
    const a = h(sampleOps());
    const changedContent = h([{ ...sampleOps()[0]!, content: '构建命令是 npm build' }, ...sampleOps().slice(1)]);
    assert.notEqual(a, changedContent);
    const changedScope = h(sampleOps(), 'other-scope');
    assert.notEqual(a, changedScope);
  });
});

test('审批：签发一次性审批，计划进入 approved', () => {
  withStore((store) => {
    const scope = store.scopes.resolvePreset('personal-global');
    const { plan } = store.plans.createPlan({ scopeId: scope.id, ops: sampleOps(), proposedBy: 'agent' });
    const { approval } = store.plans.issueApproval({ planId: plan.id, channel: 'cli' });
    assert.ok(approval.id.startsWith('apr_'));
    assert.equal(approval.uses, 0);
    assert.equal(approval.maxUses, 1);
    assert.equal(store.plans.requireById(plan.id).status, 'approved');
    // 二次签发被拒（已有在途审批或状态不允许）
    assert.throws(
      () => store.plans.issueApproval({ planId: plan.id, channel: 'cli' }),
      (e: unknown) => (e as { code?: string }).code === 'E_APPROVAL_INVALID',
    );
  });
});

test('审批：一次性消费，重放拒绝', () => {
  withStore((store) => {
    const scope = store.scopes.resolvePreset('personal-global');
    const { plan, planHash } = store.plans.createPlan({ scopeId: scope.id, ops: sampleOps(), proposedBy: 'agent' });
    const { approval } = store.plans.issueApproval({ planId: plan.id, channel: 'cli' });
    store.plans.consumeApproval(approval.id, plan.id, planHash);
    assert.throws(
      () => store.plans.consumeApproval(approval.id, plan.id, planHash),
      (e: unknown) => (e as { code?: string }).code === 'E_APPROVAL_REPLAY',
    );
    // 哈希不匹配 → 篡改
    const { plan: p2, planHash: h2 } = store.plans.createPlan({ scopeId: scope.id, ops: sampleOps(), proposedBy: 'agent' });
    const { approval: a2 } = store.plans.issueApproval({ planId: p2.id, channel: 'cli' });
    assert.throws(
      () => store.plans.consumeApproval(a2.id, p2.id, 'tampered-hash'),
      (e: unknown) => (e as { code?: string }).code === 'E_PLAN_TAMPERED',
    );
    assert.ok(h2);
  });
});

test('审批：过期拒绝', () => {
  withStore((store) => {
    const scope = store.scopes.resolvePreset('personal-global');
    const { plan, planHash } = store.plans.createPlan({ scopeId: scope.id, ops: sampleOps(), proposedBy: 'agent' });
    const { approval } = store.plans.issueApproval({ planId: plan.id, channel: 'cli', ttlMs: 1000 });
    const future = new Date(new Date(approval.expiresAt).getTime() + 60_000).toISOString();
    assert.throws(
      () => store.plans.consumeApproval(approval.id, plan.id, planHash, future),
      (e: unknown) => (e as { code?: string }).code === 'E_APPROVAL_EXPIRED',
    );
  });
});

test('计划哈希被改动：在途审批自动撤销（DB 触发器）', () => {
  withStore((store) => {
    const scope = store.scopes.resolvePreset('personal-global');
    const { plan } = store.plans.createPlan({ scopeId: scope.id, ops: sampleOps(), proposedBy: 'agent' });
    store.plans.issueApproval({ planId: plan.id, channel: 'cli' });
    // 模拟批准后计划内容被改
    store.db.run('UPDATE onboarding_plan SET plan_hash = ? WHERE id = ?', 'evil-hash', plan.id);
    const after = store.plans.requireById(plan.id);
    assert.equal(after.status, 'invalidated');
    const live = store.plans.liveApproval(plan.id);
    assert.equal(live, null, '审批被触发器撤销');
    assert.throws(() => store.plans.issueApproval({ planId: plan.id, channel: 'cli' }), /状态为 invalidated/);
  });
});

test('计划：过期清扫', () => {
  withStore((store) => {
    const scope = store.scopes.resolvePreset('personal-global');
    const { plan } = store.plans.createPlan({ scopeId: scope.id, ops: sampleOps(), proposedBy: 'agent', ttlMs: 1 });
    // 等待过期时间到达
    const expired = store.plans.expireStale(new Date(Date.now() + 100).toISOString());
    assert.ok(expired.includes(plan.id));
    assert.equal(store.plans.requireById(plan.id).status, 'expired');
  });
});

test('计划操作：目标修订快照落库', () => {
  withStore((store) => {
    const scope = store.scopes.resolvePreset('personal-global');
    const m = store.memories.add({ kind: 'fact', content: '原内容', scopeId: scope.id, authority: 'user_explicit', createdBy: 'cli' }, store.identity.deviceId);
    const ops: PlanOpInput[] = [
      { opType: 'merge', targetMemoryId: m.id, targetExpectedRevision: m.currentRevisionId, content: '合并后的新内容' },
    ];
    const { plan } = store.plans.createPlan({ scopeId: scope.id, ops, proposedBy: 'agent' });
    const [op] = store.plans.ops(plan.id);
    assert.equal(op!.targetMemoryId, m.id);
    assert.equal(op!.targetExpectedRevision, m.currentRevisionId);
    assert.ok(op!.contentHash);
    assert.notEqual(op!.contentHash, contentHash('原内容'));
  });
});
