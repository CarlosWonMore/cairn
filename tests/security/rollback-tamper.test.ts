/**
 * 安全对抗测试（任务 7.1）——回滚攻击 / 计划篡改与目标推进 / 设备克隆。
 *
 * 实现行为核对结论（写作时依据源码）：
 * - memories.revise 的 expectedCurrentRevisionId 乐观锁：不匹配抛 E_TARGET_CHANGED，
 *   库内容保持最新修订，不产生新修订。
 * - ConflictRepository.record 保留双方修订证据；检索层对 conflicted 记忆标记 conflictId。
 * - 批准后 UPDATE onboarding_plan.plan_hash → DB 触发器置 invalidated 并撤销审批，
 *   applyPlan 篡改预检（先于状态检查）抛 E_PLAN_TAMPERED。
 * - 批准后目标记忆推进 → merge op 应用时 E_TARGET_CHANGED，op failed，
 *   治理性中止（审批退役、计划回 awaiting_approval），目标内容不被覆盖。
 * - 设备克隆：DB nonce 与身份文件不一致 → E_DEVICE_CLONED；suspended →
 *   E_DEVICE_SUSPENDED；re-enroll 后恢复写入。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { openStore, CairnStore } from '../../src/store/open.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';
import { isCairnError } from '../../src/core/errors.js';
import { searchMemories } from '../../src/retrieval/search.js';
import { proposePlan, applyPlan } from '../../src/governance/index.js';
import { scanText } from '../../src/core/secrets.js';
import { contentHash } from '../../src/core/hash.js';

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

function catchCairn(fn: () => unknown): { code: string; message: string; details?: Record<string, unknown> } {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  assert.ok(caught !== undefined, '应抛出错误，但没有抛');
  assert.ok(isCairnError(caught), `应抛 CairnError，实际: ${String(caught)}`);
  return caught as unknown as { code: string; message: string; details?: Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// 场景 5：回滚攻击（修订乐观锁 + 并发冲突）
// ---------------------------------------------------------------------------

test('对抗-5a 持过期 v1 expectedCurrentRevisionId 再次 revise → E_TARGET_CHANGED，库中仍是 v2 内容', () => {
  withStore((store) => {
    const scope = store.scopes.resolvePreset('personal-global');
    const deviceId = store.identity.deviceId;
    const m = store.memories.add(
      { kind: 'fact', content: '部署端口是 8080（v1）', scopeId: scope.id, authority: 'user_explicit', createdBy: 'cli' },
      deviceId,
    );
    const rev1 = m.currentRevisionId!;
    const r2 = store.memories.revise(m.id, '部署端口改为 9090（v2）', { reason: '用户更正', author: 'cli' }, deviceId);
    const rev2 = r2.revision.id;

    // 回滚尝试：攻击者持 v1 快照宣称“目标仍是 v1”
    const e = catchCairn(() =>
      store.memories.revise(m.id, '回滚到旧内容', { reason: '回滚', author: 'attacker', expectedCurrentRevisionId: rev1 }, deviceId),
    );
    assert.equal(e.code, 'E_TARGET_CHANGED');
    assert.equal((e.details as { actual?: string }).actual, rev2, '错误明细给出真实当前修订');
    assert.notEqual((e.details as { expected?: string }).expected, rev2);

    // 库状态未被回滚：当前内容与当前修订都是 v2，不产生新修订
    const after = store.memories.require(m.id);
    assert.equal(after.content, '部署端口改为 9090（v2）');
    assert.equal(after.currentRevisionId, rev2);
    const revs = store.memories.revisions(m.id);
    assert.equal(revs.length, 2, '被拒的 revise 不留修订痕迹');
    assert.equal(revs[0]!.content, '部署端口是 8080（v1）', '历史修订原样保留（审计链完整）');
  });
});

test('对抗-5b 并发冲突保留双方：listOpen 持双方修订证据，检索明确标记 conflictId，不按 LWW 静默择一', () => {
  withStore((store) => {
    const scope = store.scopes.resolvePreset('personal-global');
    const deviceId = store.identity.deviceId;
    const m = store.memories.add(
      { kind: 'fact', content: '共同基线内容', scopeId: scope.id, authority: 'user_explicit', createdBy: 'cli' },
      deviceId,
    );
    const base = m.currentRevisionId!;
    // 写者 A：基于 base 产生 revA（成为当前）
    const revA = store.memories.revise(m.id, '写者 A 的并发内容标记甲', { reason: 'A 更正', author: 'device-a' }, deviceId).revision.id;
    // 写者 B：模拟同样基于 base 的并发修订（把当前指针拨回 base 后再 revise）
    store.db.run('UPDATE memory SET current_revision_id = ? WHERE id = ?', base, m.id);
    const revB = store.memories.revise(m.id, '写者 B 的并发内容标记乙', { reason: 'B 更正', author: 'device-b' }, deviceId).revision.id;
    assert.notEqual(revA, revB);

    const { conflict } = store.conflicts.record({ memoryId: m.id, baseRevisionId: base, revisionAId: revA, revisionBId: revB });
    assert.equal(conflict.status, 'open');
    // 双方修订证据都保留（三条修订：base + A + B）
    const open = store.conflicts.listOpen(m.id);
    assert.equal(open.length, 1);
    assert.equal(open[0]!.revisionAId, revA);
    assert.equal(open[0]!.revisionBId, revB);
    const revs = store.memories.revisions(m.id);
    assert.equal(revs.length, 3);
    assert.ok(revs.some((r) => r.id === revA && r.content.includes('标记甲')));
    assert.ok(revs.some((r) => r.id === revB && r.content.includes('标记乙')));
    assert.equal(store.memories.require(m.id).status, 'conflicted', '记忆进入 conflicted 状态');

    // 检索明确标记冲突，绝不静默当成正常 active 结果
    const r = searchMemories(store, {
      text: '并发内容标记',
      query: { deviceId, agentId: 'cli' },
      statuses: ['conflicted'],
    });
    assert.equal(r.results.length, 1);
    assert.equal(r.results[0]!.conflictId, conflict.id, '检索结果携带 conflictId');
    assert.equal(r.results[0]!.memory.status, 'conflicted');
  });
});

// ---------------------------------------------------------------------------
// 场景 6：计划篡改与目标推进
// ---------------------------------------------------------------------------

test('对抗-6a 批准后直接 UPDATE plan_hash → applyPlan E_PLAN_TAMPERED，审批不被消耗', () => {
  withStore((store) => {
    const scope = store.scopes.resolvePreset('personal-global');
    const out = proposePlan(store, {
      scopeId: scope.id,
      items: [{ content: '待篡改的计划条目', kind: 'fact' }],
      proposedBy: 'agent:x',
      scan: scanText,
    });
    const { approval } = store.plans.issueApproval({ planId: out.plan.id, channel: 'cli' });
    assert.equal(store.plans.requireById(out.plan.id).status, 'approved');

    // 攻击：批准后直接改库内 plan_hash（触发器同步失效计划、撤销审批）
    store.db.run('UPDATE onboarding_plan SET plan_hash = ? WHERE id = ?', 'evil-tampered-hash', out.plan.id);
    assert.equal(store.plans.requireById(out.plan.id).status, 'invalidated', '触发器把计划置为 invalidated');
    assert.ok(store.plans.requireApproval(approval.id).revokedAt, '在途审批被撤销');

    const e = catchCairn(() =>
      applyPlan(store, { planId: out.plan.id, approvalId: approval.id, deviceId: store.identity.deviceId, scan: scanText }),
    );
    assert.equal(e.code, 'E_PLAN_TAMPERED');
    assert.equal(store.plans.requireApproval(approval.id).uses, 0, '篡改失败不消耗审批');
    assert.equal(store.memories.countsByStatus().active, 0, '篡改计划不产生任何记忆');
  });
});

test('对抗-6b 批准后目标记忆被 revise → merge op 应用 E_TARGET_CHANGED，目标内容未被计划覆盖', () => {
  withStore((store) => {
    const scope = store.scopes.resolvePreset('personal-global');
    const deviceId = store.identity.deviceId;
    const target = store.memories.add(
      { kind: 'fact', content: '目标原文 v1', scopeId: scope.id, authority: 'user_explicit', createdBy: 'cli' },
      deviceId,
    );
    const rev1 = target.currentRevisionId!;
    const out = proposePlan(store, {
      scopeId: scope.id,
      items: [
        { content: '基于 v1 的合并内容（过期）', kind: 'fact', opHint: 'merge', targetMemoryId: target.id, targetExpectedRevision: rev1 },
        { content: '同批的正常新增条目', kind: 'fact' },
      ],
      proposedBy: 'agent:x',
      scan: scanText,
    });
    const { approval } = store.plans.issueApproval({ planId: out.plan.id, channel: 'cli' });

    // 批准后用户真实更正推进了目标
    const rev2 = store.memories.revise(target.id, '用户更正后的 v2', { reason: '用户更正', author: 'cli' }, deviceId).revision.id;

    const e = catchCairn(() =>
      applyPlan(store, { planId: out.plan.id, approvalId: approval.id, deviceId, scan: scanText }),
    );
    assert.equal(e.code, 'E_TARGET_CHANGED', '拒绝基于过期目标应用');
    assert.equal((e.details as { expected?: string }).expected, rev1);
    assert.equal((e.details as { actual?: string }).actual, rev2);

    // 目标未被计划内容覆盖
    const after = store.memories.require(target.id);
    assert.equal(after.content, '用户更正后的 v2');
    assert.equal(store.memories.revisions(target.id).length, 2, '计划不产生第 3 个修订');
    assert.equal(store.memories.findByContentHash(scope.id, contentHash('基于 v1 的合并内容（过期）')), null, '过期合并内容未入库');
    assert.equal(store.memories.findByContentHash(scope.id, contentHash('同批的正常新增条目')), null, '治理性中止后剩余 op 未应用');
    const ops = store.plans.ops(out.plan.id);
    const mergeOp = ops.find((o) => o.opType === 'merge');
    assert.equal(mergeOp?.status, 'failed');
    assert.equal(mergeOp?.error, 'target_changed');
    assert.ok(ops.some((o) => o.status === 'pending'), '剩余操作保持 pending');
    assert.equal(store.plans.requireById(out.plan.id).status, 'awaiting_approval', '计划回到待审批');
    assert.equal(store.plans.liveApproval(out.plan.id), null, '已消耗审批被就地退役');
  });
});

// ---------------------------------------------------------------------------
// 场景 11：设备克隆
// ---------------------------------------------------------------------------

test('对抗-11 设备克隆：复制 home → 篡改 nonce → 写入被拒 → re-enroll 恢复；suspended 同样拒绝', () => {
  const home = makeTestHome();
  const cloneHome = makeTestHome();
  try {
    let store = openStore({ home });
    const scope = store.scopes.resolvePreset('personal-global');
    store.memories.add(
      { kind: 'fact', content: '克隆前数据', scopeId: scope.id, authority: 'user_explicit', createdBy: 'cli' },
      store.identity.deviceId,
    );
    store.close();

    // 整目录复制到“另一台设备”
    cpSync(home, cloneHome, { recursive: true });

    // 库中 nonce 被另一个写入者推进（模拟原设备已演进，副本成为克隆）
    {
      const raw = new DatabaseSync(join(cloneHome, 'data', 'cairn.db'));
      raw.exec("UPDATE device SET instance_nonce = 'nonce-advanced-by-original-device'");
      raw.close();
    }

    const reopened = openStore({ home: cloneHome });
    try {
      assert.equal(reopened.cloneCheck.cloned, true, 'nonce 不一致判定为克隆');
      const e1 = catchCairn(() =>
        reopened.memories.add(
          {
            kind: 'fact',
            content: '克隆体写入',
            scopeId: reopened.scopes.resolvePreset('personal-global').id,
            authority: 'user_explicit',
            createdBy: 'cli',
          },
          reopened.identity.deviceId,
        ),
      );
      assert.equal(e1.code, 'E_DEVICE_CLONED', '克隆写入被拒');
      // 读取不受影响
      assert.ok(reopened.memories.list().length >= 1, '克隆体仍可读');

      // re-enroll：新身份，恢复写入，旧身份留 suspended 证据
      const r = reopened.reEnroll();
      assert.notEqual(r.identity.deviceId, r.old.deviceId, 're-enroll 生成全新设备身份');
      assert.equal(reopened.cloneCheck.cloned, false);
      const scope2 = reopened.scopes.resolvePreset('personal-global');
      const ok = reopened.memories.add(
        { kind: 'fact', content: '重新登记后的写入', scopeId: scope2.id, authority: 'user_explicit', createdBy: 'cli' },
        reopened.identity.deviceId,
      );
      assert.ok(ok.id, 're-enroll 后写入恢复');
      const oldRow = reopened.db.get('SELECT enrollment, instance_nonce FROM device WHERE id = ?', r.old.deviceId);
      assert.ok(oldRow, '旧设备行保留为证据');
      // 实现现状（reEnrollDevice 的条件分支）：suspended 证据仅在旧身份 nonce 仍与库一致时打上；
      // 本场景库内 nonce 已被另一写入者推进（divergent），旧行保持原 enrollment——
      // 克隆体的 containment 由“身份文件 nonce ≠ 库 nonce → E_DEVICE_CLONED”承担。
      assert.equal(oldRow?.instance_nonce, 'nonce-advanced-by-original-device', '旧行 nonce 证据未被抹改');
      const newRow = reopened.db.get('SELECT enrollment FROM device WHERE id = ?', r.identity.deviceId);
      assert.equal(newRow?.enrollment, 'active', '新设备身份为 active');
    } finally {
      reopened.close();
    }

    // suspended 状态同样拒绝写入（E_DEVICE_SUSPENDED）
    {
      const raw = new DatabaseSync(join(home, 'data', 'cairn.db'));
      raw.exec("UPDATE device SET enrollment = 'suspended', suspended_reason = 'test'");
      raw.close();
      const s = openStore({ home });
      try {
        const e2 = catchCairn(() =>
          s.memories.add(
            { kind: 'fact', content: '暂停期写入', scopeId: s.scopes.resolvePreset('personal-global').id, authority: 'user_explicit', createdBy: 'cli' },
            s.identity.deviceId,
          ),
        );
        assert.equal(e2.code, 'E_DEVICE_SUSPENDED');
      } finally {
        s.close();
      }
    }
  } finally {
    cleanupTestHome(home);
    cleanupTestHome(cloneHome);
  }
});
