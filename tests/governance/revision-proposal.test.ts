import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { AppService } from '../../src/interfaces/app-service.js';
import { revisionsPath, loadRevisionsFile, countPendingRevisions } from '../../src/governance/revision-proposal.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';

/**
 * 方案卡存储与生成（add-agent-managed-revision 任务 1.4 / 2.4）：
 * 写读往返、坏 JSON 不崩、陈旧判定、生成后记忆逐字段不变、秘密拒绝不落盘。
 */

function setup(contents: string[] = ['部署脚本入口是 scripts/deploy.mjs']) {
  const home = makeTestHome('cairn-rev-');
  const service = AppService.open(home);
  const ids = contents.map((c) => service.addMemory({ content: c }).memory!.id);
  return { service, home, ids };
}

test('proposeRevision：写读往返，记录提出时修订与摘要', () => {
  const { service, home, ids } = setup();
  try {
    const rec = service.proposeRevisionProposal({
      memoryId: ids[0]!,
      afterContent: '部署脚本入口是 scripts/deploy.mjs（先跑 doctor）',
      reason: '补充部署前置检查',
    });
    assert.equal(rec.status, 'pending');
    assert.equal(rec.revisionIdAtPropose, service.store.memories.require(ids[0]!).currentRevisionId);
    assert.ok(rec.beforeExcerpt!.includes('部署脚本入口'));

    const list = service.listRevisionProposals({ status: 'pending' });
    assert.equal(list.length, 1);
    assert.equal(list[0]!.id, rec.id);
    assert.equal(list[0]!.stale, false);
    assert.equal(countPendingRevisions(home), 1);
  } finally {
    service.close();
    cleanupTestHome(home);
  }
});

test('坏 JSON 按空处理；格式错误的条目被丢弃不崩', () => {
  const { service, home, ids } = setup();
  try {
    mkdirSync(`${home}/console`, { recursive: true });
    writeFileSync(revisionsPath(home), '{ not valid json !!', 'utf8');
    assert.deepEqual(service.listRevisionProposals({ status: 'all' }), []);

    writeFileSync(revisionsPath(home), JSON.stringify({ version: 1, items: [{ id: 'x', memoryId: ids[0]!, afterContent: '' }, { broken: true }] }), 'utf8');
    assert.deepEqual(service.listRevisionProposals({ status: 'all' }), [], '缺 afterContent / 结构坏的条目被丢弃');
  } finally {
    service.close();
    cleanupTestHome(home);
  }
});

test('陈旧判定：记忆被改后 pending 提案标 stale（提案本身保留）', () => {
  const { service, home, ids } = setup();
  try {
    service.proposeRevisionProposal({ memoryId: ids[0]!, afterContent: '新正文', reason: 'r' });
    service.reviseMemory(ids[0]!, '先被人改了一版', { reason: '人工更正' });
    const list = service.listRevisionProposals({ status: 'pending' });
    assert.equal(list.length, 1);
    assert.equal(list[0]!.stale, true);
  } finally {
    service.close();
    cleanupTestHome(home);
  }
});

test('生成提案不改记忆：正文/状态/权威/修订数/作用域逐字段不变', () => {
  const { service, home, ids } = setup();
  try {
    const store = service.store;
    const before = store.memories.require(ids[0]!);
    const revCount = store.memories.revisions(ids[0]!).length;
    const jobCount = store.outbox.list({ limit: 100 }).length;

    service.proposeRevisionProposal({ memoryId: ids[0]!, afterContent: '完全不同的正文', reason: 'r' });

    const after = store.memories.require(ids[0]!);
    assert.equal(after.content, before.content);
    assert.equal(after.status, before.status);
    assert.equal(after.authority, before.authority);
    assert.equal(after.currentRevisionId, before.currentRevisionId);
    assert.equal(after.scopeId, before.scopeId);
    assert.equal(store.memories.revisions(ids[0]!).length, revCount);
    assert.equal(store.outbox.list({ limit: 100 }).length, jobCount, '提案不碰 outbox');
  } finally {
    service.close();
    cleanupTestHome(home);
  }
});

test('秘密扫描在生成时就拒绝，且不落盘', () => {
  const { service, home, ids } = setup();
  try {
    // AWS 文档示例形态（AKIA + 40 位密文）命中秘密规则
    assert.throws(
      () => service.proposeRevisionProposal({
        memoryId: ids[0]!,
        afterContent: '密钥是 AKIAIOSFODNN7EXAMPLE 组合 wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        reason: 'r',
      }),
      (e: { code?: string }) => e.code === 'E_SECRET_DETECTED',
    );
    assert.equal(existsSync(revisionsPath(home)), false, '拒绝时不得落盘（落盘即泄露）');
  } finally {
    service.close();
    cleanupTestHome(home);
  }
});

test('采纳后权威是 user_confirmed；陈旧拒绝且记忆不变；拒绝后不出现在待办', () => {
  const { service, home, ids } = setup();
  try {
    const memId = ids[0]!;
    const rec = service.proposeRevisionProposal({ memoryId: memId, afterContent: '采纳后的正文', reason: '修措辞' });

    // 采纳：权威 user_confirmed（D4），修订链走既有 reviseMemory
    const r = service.applyRevisionProposal(rec.id);
    assert.equal(r.memory.authority, 'user_confirmed');
    assert.equal(r.memory.content, '采纳后的正文');
    assert.equal(service.listRevisionProposals({ status: 'pending' }).length, 0, '采纳后不再出现在待办');
    assert.equal(service.listRevisionProposals({ status: 'applied' }).length, 1);

    // 陈旧：提案基于旧修订，记忆已变 → 拒绝、标 stale、记忆不变
    const staleRec = service.proposeRevisionProposal({ memoryId: memId, afterContent: '又一个新正文', reason: 'r2' });
    service.reviseMemory(memId, '人事后改了一版', { reason: '人工' });
    const beforeStale = service.store.memories.require(memId);
    assert.throws(
      () => service.applyRevisionProposal(staleRec.id),
      (e: { code?: string }) => e.code === 'E_CONFLICT_STATE',
    );
    const afterStale = service.store.memories.require(memId);
    assert.equal(afterStale.content, beforeStale.content, '陈旧拒绝时记忆不变');
    assert.equal(service.listRevisionProposals({ status: 'stale' }).length, 1);

    // 拒绝：留理由与时间，不删除提案，记忆零影响
    const rec3 = service.proposeRevisionProposal({ memoryId: memId, afterContent: '不该改的内容', reason: 'r3' });
    const beforeReject = service.store.memories.require(memId);
    const rejected = service.rejectRevisionProposal(rec3.id, '理由不成立');
    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.rejectReason, '理由不成立');
    assert.ok(rejected.resolvedAt);
    const afterReject = service.store.memories.require(memId);
    assert.equal(afterReject.content, beforeReject.content);
    assert.equal(afterReject.currentRevisionId, beforeReject.currentRevisionId);
    assert.equal(service.listRevisionProposals({ status: 'pending' }).length, 0, '拒绝后不再出现在待办');
    // 终态不能重复处置
    assert.throws(() => service.rejectRevisionProposal(rec3.id, '再拒一次'), (e: { code?: string }) => e.code === 'E_CONFLICT_STATE');
  } finally {
    service.close();
    cleanupTestHome(home);
  }
});

test('loadRevisionsFile 导出的提案文件可重新读取（往返保真）', () => {
  const { service, home, ids } = setup();
  try {
    const rec = service.proposeRevisionProposal({
      memoryId: ids[0]!,
      afterContent: '往返正文',
      reason: '往返理由',
      annotationId: 'ann_x',
    });
    const raw = loadRevisionsFile(home);
    assert.equal(raw.items.length, 1);
    assert.equal(raw.items[0]!.id, rec.id);
    assert.equal(raw.items[0]!.annotationId, 'ann_x');
    assert.equal(raw.items[0]!.afterContent, '往返正文');
  } finally {
    service.close();
    cleanupTestHome(home);
  }
});
