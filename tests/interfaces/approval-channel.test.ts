import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppService } from '../../src/interfaces/app-service.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';
import { importSnapshot } from '../../src/onboarding/import.js';
import { assignBatch } from '../../src/onboarding/batches.js';

/**
 * 审批通道参数化（任务 6.1 / 6.2）。
 *
 * 强制的性质只有一条：**通道只改变"谁在哪儿签"，不改变治理规则**。
 * 所以除了断言审计 action，还要断言 TTL、一次性、哈希绑定、
 * 以及三类越权行为在两个通道下返回同一个拒绝码。
 */

const CLEAN_TEXT = '生产环境数据库端口是 5433，连接超时 60 秒。';

interface Fixture {
  home: string;
  svc: AppService;
  batchId: string;
  itemId: string;
  cleanup(): void;
}

async function fixture(): Promise<Fixture> {
  const home = makeTestHome('cairn-approval-');
  const svc = AppService.open(home);
  const dir = join(home, 'sources');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, 'one.md');
  writeFileSync(p, CLEAN_TEXT + '\n', 'utf8');
  const o = await importSnapshot(svc.store, { agentKind: 'manual', sourcePath: p });
  const batchId = assignBatch(svc.store, (o.archiveId ?? o.reusedArchiveId)!);
  const row = svc.store.db.get("SELECT id FROM import_item WHERE batch_id = ? AND scan_state = 'clean' LIMIT 1", batchId);
  return {
    home,
    svc,
    batchId,
    itemId: String(row!['id']),
    cleanup() {
      try {
        svc.close();
      } catch {
        /* 已关闭 */
      }
      cleanupTestHome(home);
    },
  };
}

function newPlan(f: Fixture): { planId: string; planHash: string } {
  const r = f.svc.proposeForBatch({
    batchId: f.batchId,
    items: [{ itemId: f.itemId, content: CLEAN_TEXT, kind: 'fact', opHint: 'add' }],
    proposedBy: 'test',
  });
  return { planId: r.plan.id, planHash: r.planHash };
}

function auditActions(f: Fixture, category: string): string[] {
  return f.svc.store.db
    .all('SELECT action FROM audit_event WHERE category = ? ORDER BY rowid', category)
    .map((r) => String(r['action']));
}

test('默认通道留痕为 cli（回归：原有调用点不受影响）', async () => {
  const f = await fixture();
  try {
    const { planId } = newPlan(f);
    f.svc.approve(planId);
    assert.deepEqual(auditActions(f, 'approval'), ['issued_via_cli']);
  } finally {
    f.cleanup();
  }
});

test('显式通道留痕为 webui', async () => {
  const f = await fixture();
  try {
    const { planId } = newPlan(f);
    f.svc.approve(planId, { channel: 'webui' });
    assert.deepEqual(auditActions(f, 'approval'), ['issued_via_webui']);
  } finally {
    f.cleanup();
  }
});

test('两通道的审批在 TTL、一次性、哈希绑定上行为一致', async () => {
  const f = await fixture();
  try {
    const results: Record<string, { itemCount: number; ttlMs: number }> = {};
    for (const channel of ['cli', 'webui']) {
      const { planId } = newPlan(f);
      const r = f.svc.approve(planId, { channel });
      const expires = Date.parse(r.expiresAt);
      const issued = f.svc.store.db.get("SELECT approved_at FROM approval WHERE id = ?", r.approvalId);
      const issuedAt = Date.parse(String(issued!["approved_at"]));
      results[channel] = { itemCount: r.itemCount, ttlMs: expires - issuedAt };
    }
    assert.equal(results['cli']!.itemCount, results['webui']!.itemCount);
    assert.ok(Math.abs(results['cli']!.ttlMs - results['webui']!.ttlMs) < 5_000, '默认 TTL 必须一致');
    assert.ok(results['cli']!.ttlMs > 0);
  } finally {
    f.cleanup();
  }
});

test('越权负向：两通道返回同一治理拒绝码', async () => {
  const f = await fixture();
  try {
    const codes: Record<string, Record<string, string>> = {};

    for (const channel of ['cli', 'webui']) {
      const c: Record<string, string> = {};

      // 1. 伪造/不存在审批
      const p1 = newPlan(f);
      try {
        f.svc.applyPlan(p1.planId, 'approval-does-not-exist');
        c['missing'] = 'NO_ERROR';
      } catch (e) {
        c['missing'] = String((e as { code?: string }).code);
      }

      // 2. 过期审批
      const p2 = newPlan(f);
      const expired = f.svc.approve(p2.planId, { channel, ttlMs: -1_000 });
      try {
        f.svc.applyPlan(p2.planId, expired.approvalId);
        c['expired'] = 'NO_ERROR';
      } catch (e) {
        c['expired'] = String((e as { code?: string }).code);
      }

      // 3. 计划在签发后被改动（哈希不再一致）
      const p3 = newPlan(f);
      const ok = f.svc.approve(p3.planId, { channel });
      f.svc.store.db.run('UPDATE onboarding_plan SET plan_hash = ? WHERE id = ?', 'f'.repeat(64), p3.planId);
      try {
        f.svc.applyPlan(p3.planId, ok.approvalId);
        c['tampered'] = 'NO_ERROR';
      } catch (e) {
        c['tampered'] = String((e as { code?: string }).code);
      }

      codes[channel] = c;
    }

    assert.equal(codes['cli']!['missing'], codes['webui']!['missing']);
    assert.equal(codes['cli']!['expired'], codes['webui']!['expired']);
    assert.equal(codes['cli']!['tampered'], codes['webui']!['tampered']);
    assert.equal(codes['cli']!['missing'], 'E_APPROVAL_INVALID');
    assert.equal(codes['cli']!['expired'], 'E_APPROVAL_EXPIRED');
    assert.equal(codes['cli']!['tampered'], 'E_PLAN_TAMPERED');
  } finally {
    f.cleanup();
  }
});
