import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppService } from '../../src/interfaces/app-service.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';
import { parseJudgement } from '../../src/onboarding/judgement.js';

const CONTENT = '生产环境数据库端口是 5433，连接超时 60 秒';

function setup() {
  const home = makeTestHome('cairn-wj-');
  const service = AppService.open(home);
  return {
    service,
    auditActions(): string[] {
      return service.store.db
        .all("SELECT action FROM audit_event WHERE category = 'memory' ORDER BY at")
        .map((r) => String(r.action));
    },
    activeCount(predicate = '1=1'): number {
      return Number(service.store.db.get(`SELECT count(*) AS n FROM memory WHERE ${predicate}`)!.n);
    },
    cleanup() {
      service.close();
      cleanupTestHome(home);
    },
  };
}

function judge(over: Record<string, unknown> = {}) {
  return parseJudgement({ verdict: 'keep', confidence: 'high', rationale: '环境事实，长期有效', ...over });
}

test('首次写入：无判断无重复 → insert，落一条 active', () => {
  const s = setup();
  try {
    const r = s.service.addMemory({ content: CONTENT, kind: 'fact', scope: { preset: 'personal-global' } });
    assert.equal(r.action, 'insert');
    assert.equal(r.memory?.status, 'active');
    assert.equal(s.activeCount(), 1);
    assert.deepEqual(s.auditActions(), ['added']);
  } finally {
    s.cleanup();
  }
});

test('同内容二次写入 → merge，记忆数不变，证据累积', () => {
  const s = setup();
  try {
    const first = s.service.addMemory({ content: CONTENT, kind: 'fact', scope: { preset: 'personal-global' } });
    const before = s.service.store.memories.evidence(first.memory!.id).length;
    const second = s.service.addMemory({ content: CONTENT, kind: 'fact', scope: { preset: 'personal-global' } });
    assert.equal(second.action, 'merge');
    assert.equal(second.duplicateOf, first.memory!.id, '应指向既有记忆');
    assert.equal(second.memory?.id, first.memory!.id);
    assert.equal(s.activeCount(), 1, '不得产生第二条 active 记忆');
    const after = s.service.store.memories.evidence(first.memory!.id).length;
    assert.ok(after > before, `证据应从 ${before} 增加到更多，实际 ${after}`);
    assert.deepEqual(s.auditActions(), ['added', 'write_merged']);
  } finally {
    s.cleanup();
  }
});

test('不同作用域同内容 → 各存一条（不跨作用域合并）', () => {
  const s = setup();
  try {
    s.service.addMemory({ content: CONTENT, kind: 'fact', scope: { preset: 'personal-global' } });
    const r = s.service.addMemory({ content: CONTENT, kind: 'fact', scope: { preset: 'device-local' } });
    assert.equal(r.action, 'insert');
    assert.equal(s.activeCount(), 2);
  } finally {
    s.cleanup();
  }
});

test('skip + high：不写库，但审计留痕', () => {
  const s = setup();
  try {
    const r = s.service.addMemory(
      { content: '标题行不该成为记忆', kind: 'fact', scope: { preset: 'personal-global' } },
      { judgement: judge({ verdict: 'skip' }) },
    );
    assert.equal(r.action, 'skip');
    assert.equal(r.memory, null);
    assert.equal(s.activeCount(), 0);
    assert.deepEqual(s.auditActions(), ['write_skipped'], '被判断拦下的写入必须可追溯');
  } finally {
    s.cleanup();
  }
});

test('skip + low：降为候选而不是丢弃', () => {
  const s = setup();
  try {
    const r = s.service.addMemory(
      { content: '可能有用但不确定的一句', kind: 'fact', scope: { preset: 'personal-global' } },
      { judgement: judge({ verdict: 'skip', confidence: 'low' }) },
    );
    assert.equal(r.action, 'candidate');
    assert.equal(r.memory?.status, 'candidate', '低置信不得直接丢弃，只能是可逆降级');
    assert.equal(s.activeCount("status = 'active'"), 0);
    assert.equal(s.activeCount("status = 'candidate'"), 1);
  } finally {
    s.cleanup();
  }
});

test('keep_both：即便已有同内容也新建（用户显式要求并存）', () => {
  const s = setup();
  try {
    const first = s.service.addMemory({ content: CONTENT, kind: 'fact', scope: { preset: 'personal-global' } });
    const r = s.service.addMemory(
      { content: CONTENT, kind: 'fact', scope: { preset: 'personal-global' } },
      { judgement: judge({ dedupe: 'keep_both' }) },
    );
    assert.equal(r.action, 'insert');
    assert.notEqual(r.memory!.id, first.memory!.id);
    assert.equal(s.activeCount(), 2);
  } finally {
    s.cleanup();
  }
});

test('merge_into 指向不存在的记忆 → 报错，不落库', () => {
  const s = setup();
  try {
    assert.throws(
      () =>
        s.service.addMemory(
          { content: CONTENT, kind: 'fact', scope: { preset: 'personal-global' } },
          { judgement: judge({ verdict: 'merge_into:01j-nonexistent' }) },
        ),
      /E_NOT_FOUND|不存在/,
    );
    assert.equal(s.activeCount(), 0);
  } finally {
    s.cleanup();
  }
});

test('merge_into 指向其它作用域的记忆 → 拒绝（判断不能改作用域）', () => {
  const s = setup();
  try {
    const other = s.service.addMemory({ content: '另一作用域里的一条', kind: 'fact', scope: { preset: 'device-local' } });
    assert.throws(
      () =>
        s.service.addMemory(
          { content: CONTENT, kind: 'fact', scope: { preset: 'personal-global' } },
          { judgement: judge({ verdict: `merge_into:${other.memory!.id}` }) },
        ),
      /作用域相同|E_VALIDATION/,
    );
  } finally {
    s.cleanup();
  }
});

test('判断里夹带 sensitivity 不生效：敏感度只由写入参数决定', () => {
  const s = setup();
  try {
    // 未知字段被忽略，而不是被采纳——否则判断就成了降级敏感度的后门。
    const j = parseJudgement({
      verdict: 'keep',
      confidence: 'high',
      rationale: '含住址',
      sensitivity: 'normal',
    });
    const r = s.service.addMemory(
      { content: '我的家庭住址是某某路 12 号 3 单元', kind: 'fact', sensitivity: 'sensitive', scope: { preset: 'device-local' } },
      { judgement: j },
    );
    assert.equal(r.action, 'insert');
    assert.equal(r.memory?.sensitivity, 'sensitive', '必须按写入参数落库');
  } finally {
    s.cleanup();
  }
});

test('候选被显式写入命中时晋升为 active，而不是留下两条', () => {
  const s = setup();
  try {
    const cand = s.service.addMemory({
      content: '构建产物目录是 dist',
      kind: 'fact',
      authority: 'agent_inferred',
      scope: { preset: 'personal-global' },
    });
    assert.equal(cand.memory?.status, 'candidate');
    const r = s.service.addMemory({ content: '构建产物目录是 dist', kind: 'fact', scope: { preset: 'personal-global' } });
    assert.equal(r.action, 'promote_candidate');
    assert.equal(r.memory?.id, cand.memory!.id);
    assert.equal(r.memory?.status, 'active');
    assert.equal(s.activeCount(), 1, '不得候选与正式各留一条');
  } finally {
    s.cleanup();
  }
});
