import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppService } from '../../src/interfaces/app-service.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';
import {
  annotationsPath,
  loadAnnotationsFile,
  DISPOSITIONS,
} from '../../src/interfaces/console/annotations.js';

/**
 * 批注（OpenSpec: add-memory-annotations 任务 1.4 / 2.5）：
 * 落盘往返、坏文件容错、陈旧判定，以及最重要的一条——
 * **批注不修改记忆的任何字段**（正文 / 状态 / 修订链 / outbox 全部逐字段断言）。
 */

const FAKE_AWS_ID = 'AKIAIOSFODNN7EXAMPLE';

interface Ctx {
  home: string;
  svc: AppService;
  cleanup(): void;
}

function setup(): Ctx {
  const home = makeTestHome('cairn-annot-');
  const svc = AppService.open(home);
  return {
    home,
    svc,
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

function addMem(ctx: Ctx, content: string): string {
  const r = ctx.svc.addMemory({ content });
  assert.ok(r.memory, '测试记忆应写入成功');
  return r.memory.id;
}

/** 记忆的全部权威字段 + 修订链 + 墓碑 + outbox 计数，用于"零改动"逐字段断言。 */
function snapshot(ctx: Ctx) {
  return {
    memory: JSON.stringify(ctx.svc.store.db.all('SELECT * FROM memory ORDER BY id')),
    revisions: JSON.stringify(ctx.svc.store.db.all('SELECT * FROM memory_revision ORDER BY id')),
    tombstones: Number(ctx.svc.store.db.scalar('SELECT COUNT(*) AS n FROM tombstone') ?? 0),
    outbox: Number(ctx.svc.store.db.scalar('SELECT COUNT(*) AS n FROM outbox_job') ?? 0),
    outboxPayloads: JSON.stringify(ctx.svc.store.db.all('SELECT payload FROM outbox_job ORDER BY id')),
  };
}

test('annotateMemory：写→读往返，记忆逐字段不变，且批注文件在 console/ 下', () => {
  const ctx = setup();
  try {
    const memoryId = addMem(ctx, '部署窗口是每周四晚十点，发布前先冻结变更。');
    const before = snapshot(ctx);
    const rec = ctx.svc.annotateMemory({ memoryId, disposition: 'needs_edit', note: '日期写错了，应该是周五' });

    assert.ok(rec.id.startsWith('ann_'));
    assert.equal(rec.memoryId, memoryId);
    assert.equal(rec.disposition, 'needs_edit');
    assert.equal(rec.status, 'open');
    assert.equal(rec.resolvedAt, null);
    assert.ok(rec.revisionIdAtWrite != null, '必须记下写入时的修订作为陈旧判定依据');

    const list = ctx.svc.listAnnotations({ memoryId });
    assert.equal(list.length, 1);
    assert.equal(list[0]!.note, '日期写错了，应该是周五');
    assert.equal(list[0]!.stale, false);
    assert.equal(list[0]!.memoryStatus, 'active');

    const after = snapshot(ctx);
    assert.deepEqual(after, before, '批注必须不改记忆、修订链、墓碑与 outbox');

    // 检索不受影响
    const hits = ctx.svc.search({ text: '部署窗口', query: { deviceId: ctx.svc.caller.deviceId, agentId: ctx.svc.caller.agentId } });
    assert.equal(hits.results.length, 1);
    assert.equal(hits.results[0]!.memory.content, '部署窗口是每周四晚十点，发布前先冻结变更。');

    assert.ok(annotationsPath(ctx.home).includes(join('console')));
    assert.ok(existsSync(annotationsPath(ctx.home)));
  } finally {
    ctx.cleanup();
  }
});

test('坏 JSON 不崩：按空处理，之后仍可正常写入', () => {
  const ctx = setup();
  try {
    const memoryId = addMem(ctx, '一条普通记忆，用于验证坏文件容错。');
    mkdirSync(join(ctx.home, 'console'), { recursive: true });
    writeFileSync(annotationsPath(ctx.home), '{not valid json', 'utf8');

    assert.deepEqual(ctx.svc.listAnnotations({}), []);
    const rec = ctx.svc.annotateMemory({ memoryId, disposition: 'uncertain', note: '' });
    assert.equal(rec.status, 'open');
    assert.equal(ctx.svc.listAnnotations({}).length, 1);
    // 坏文件已被合法文件覆盖
    assert.equal(loadAnnotationsFile(ctx.home).items.length, 1);
  } finally {
    ctx.cleanup();
  }
});

test('陈旧判定：记忆修订后标 stale，批注保留不删', () => {
  const ctx = setup();
  try {
    const memoryId = addMem(ctx, '原始正文：构建命令是 pnpm build。');
    const rec = ctx.svc.annotateMemory({ memoryId, disposition: 'needs_edit', note: '补充产物目录' });
    assert.equal(ctx.svc.listAnnotations({})[0]!.stale, false);

    ctx.svc.reviseMemory(memoryId, '新正文：构建命令是 pnpm build，产物目录 dist。');

    const after = ctx.svc.listAnnotations({ memoryId });
    assert.equal(after.length, 1, '陈旧不等于删除');
    assert.equal(after[0]!.id, rec.id);
    assert.equal(after[0]!.stale, true);
    assert.match(String(after[0]!.staleReason), /记忆已变更/);
    assert.equal(loadAnnotationsFile(ctx.home).items.length, 1, '批注文件里也仍然保留');
  } finally {
    ctx.cleanup();
  }
});

test('目标记忆被遗忘后：批注标 stale 且不丢失', () => {
  const ctx = setup();
  try {
    const memoryId = addMem(ctx, '这条记忆稍后会被遗忘，用于验证批注的陈旧提示。');
    ctx.svc.annotateMemory({ memoryId, disposition: 'can_delete', note: '' });
    ctx.svc.forgetMemory(memoryId, '测试');
    const list = ctx.svc.listAnnotations({ memoryId });
    assert.equal(list.length, 1);
    assert.equal(list[0]!.stale, true, '修订链未动，但记忆已是墓碑——不能假装一切正常');
    assert.equal(list[0]!.memoryStatus, 'tombstoned');
  } finally {
    ctx.cleanup();
  }
});

test('秘密批注：写入被拒，且文件里不存在该文本（不脱敏保存）', () => {
  const ctx = setup();
  try {
    const memoryId = addMem(ctx, '一条普通记忆，用于验证秘密扫描。');
    assert.throws(
      () => ctx.svc.annotateMemory({ memoryId, disposition: 'needs_edit', note: `把密钥 ${FAKE_AWS_ID} 记在这里` }),
      (e: unknown) => {
        const err = e as { code?: string; message?: string; details?: unknown };
        assert.equal(err.code, 'E_SECRET_DETECTED');
        assert.equal(JSON.stringify(err).includes(FAKE_AWS_ID), false, '错误不得回显原文');
        assert.equal(JSON.stringify(err.details ?? {}).includes(FAKE_AWS_ID), false, '详情不得回显原文');
        return true;
      },
    );
    assert.equal(existsSync(annotationsPath(ctx.home)), false, '被拒时不应产生批注文件');
    assert.equal(ctx.svc.listAnnotations({}).length, 0);

    // 批量路径的共享 note 同样整批拒绝
    assert.throws(
      () => ctx.svc.annotateBatch({ memoryIds: [memoryId], disposition: 'can_delete', note: `密钥 ${FAKE_AWS_ID}` }),
      (e: unknown) => (e as { code?: string }).code === 'E_SECRET_DETECTED',
    );
    assert.equal(ctx.svc.listAnnotations({}).length, 0);
  } finally {
    ctx.cleanup();
  }
});

test('批量标记：逐条校验，单条失败不中断，分别计数', () => {
  const ctx = setup();
  try {
    const a = addMem(ctx, '批量标记第一条记忆，内容足够区分。');
    const b = addMem(ctx, '批量标记第二条记忆，内容足够区分。');
    const before = snapshot(ctx);
    const r = ctx.svc.annotateBatch({
      memoryIds: [a, b, 'mem_does_not_exist'],
      disposition: 'can_delete',
      note: '这批都是过期内容',
    });
    assert.equal(r.succeeded, 2);
    assert.equal(r.failed.length, 1);
    assert.equal(r.failed[0]!.memoryId, 'mem_does_not_exist');
    assert.equal(r.failed[0]!.code, 'E_NOT_FOUND');
    assert.equal(r.annotations.length, 2);
    assert.equal(ctx.svc.listAnnotations({ disposition: 'can_delete' }).length, 2);
    assert.deepEqual(snapshot(ctx), before, '批量标记同样不得改记忆或 outbox');
  } finally {
    ctx.cleanup();
  }
});

test('pending_forget：只标记不删除，记忆仍 active、仍可检索', () => {
  const ctx = setup();
  try {
    const memoryId = addMem(ctx, '这条被标为待删，但在终端确认前必须保持活动。');
    const before = snapshot(ctx);
    ctx.svc.annotateMemory({ memoryId, disposition: 'pending_forget', note: '看着像过期了' });

    assert.equal(ctx.svc.showMemory(memoryId).memory.status, 'active');
    assert.deepEqual(snapshot(ctx), before, 'pending_forget 不得触发任何删除或上行');
    // 检索放在快照对比之后：检索本身会更新 usage_count（既有使用信号），
    // 那是读操作的正常副作用，不属于批注改动。
    assert.equal(ctx.svc.search({ text: '在终端确认前必须保持活动', query: { deviceId: ctx.svc.caller.deviceId, agentId: ctx.svc.caller.agentId } }).results.length, 1);

    const pending = ctx.svc.listPendingForget();
    assert.equal(pending.length, 1);
    assert.equal(pending[0]!.memoryId, memoryId);
    assert.equal(pending[0]!.memoryStatus, 'active');
  } finally {
    ctx.cleanup();
  }
});

test('resolveAnnotation：记录处置者与时间；非法状态被拒且不改动文件', () => {
  const ctx = setup();
  try {
    const memoryId = addMem(ctx, '一条等待被 Agent 处置的记忆。');
    const rec = ctx.svc.annotateMemory({ memoryId, disposition: 'needs_merge', note: '应并入部署笔记' });

    assert.throws(
      () => ctx.svc.resolveAnnotation({ id: rec.id, status: 'done', by: 'test-agent' }),
      (e: unknown) => (e as { code?: string }).code === 'E_VALIDATION',
    );
    assert.equal(ctx.svc.listAnnotations({}).length, 1);
    assert.equal(loadAnnotationsFile(ctx.home).items[0]!.status, 'open', '非法状态不得改动批注');

    const resolved = ctx.svc.resolveAnnotation({ id: rec.id, status: 'resolved', by: 'test-agent' });
    assert.equal(resolved.status, 'resolved');
    assert.equal(resolved.resolvedBy, 'test-agent');
    assert.match(String(resolved.resolvedAt), /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(ctx.svc.listAnnotations({ status: 'open' }).length, 0);
    assert.equal(ctx.svc.listAnnotations({ status: 'resolved' }).length, 1);
  } finally {
    ctx.cleanup();
  }
});

test('doctor：待办批注只进 notes、不进 problems、不改 ok 与退出码', () => {
  const ctx = setup();
  try {
    const a = addMem(ctx, '一条需要人工处理的记忆。');
    ctx.svc.annotateMemory({ memoryId: a, disposition: 'needs_edit', note: '' });
    const d = ctx.svc.doctor();
    assert.equal(d.ok, true, '批注不是健康问题');
    assert.equal(d.problems.length, 0);
    assert.ok(d.notes.some((n) => /^待办批注 1 条/.test(n)), `notes 应含待办批注计数，实际 ${JSON.stringify(d.notes)}`);

    // no_action 是"无需处理"，不应计入待办
    const b = addMem(ctx, '另一条明确无需处理的记忆。');
    ctx.svc.annotateMemory({ memoryId: b, disposition: 'no_action', note: '' });
    const d2 = ctx.svc.doctor();
    assert.ok(d2.notes.some((n) => /^待办批注 1 条/.test(n)), 'no_action 不该把待办数抬高');
    assert.equal(d2.ok, true);
  } finally {
    ctx.cleanup();
  }
});

test('删掉批注文件：列表为空，记忆与修订链完全不受影响', () => {
  const ctx = setup();
  try {
    const memoryId = addMem(ctx, '删除批注文件后，这条记忆必须原样存在。');
    const before = snapshot(ctx);
    ctx.svc.annotateMemory({ memoryId, disposition: 'needs_edit', note: '一条意见' });
    rmSync(annotationsPath(ctx.home), { force: true });

    assert.deepEqual(ctx.svc.listAnnotations({}), []);
    assert.deepEqual(snapshot(ctx), before);
    assert.equal(ctx.svc.showMemory(memoryId).memory.content, '删除批注文件后，这条记忆必须原样存在。');
    // 回滚后仍可继续使用
    ctx.svc.annotateMemory({ memoryId, disposition: 'no_action', note: '' });
    assert.equal(ctx.svc.listAnnotations({}).length, 1);
  } finally {
    ctx.cleanup();
  }
});

test('disposition 枚举覆盖 spec 要求的五类 + 标记待删', () => {
  for (const d of ['needs_edit', 'needs_merge', 'can_delete', 'uncertain', 'no_action', 'pending_forget']) {
    assert.ok((DISPOSITIONS as readonly string[]).includes(d), `缺少处置类别 ${d}`);
  }
  const ctx = setup();
  try {
    const memoryId = addMem(ctx, '一条用于验证非法类别被拒的记忆。');
    assert.throws(
      () => ctx.svc.annotateMemory({ memoryId, disposition: 'delete_now', note: '' }),
      (e: unknown) => (e as { code?: string }).code === 'E_VALIDATION',
    );
    assert.equal(ctx.svc.listAnnotations({}).length, 0);
  } finally {
    ctx.cleanup();
  }
});
