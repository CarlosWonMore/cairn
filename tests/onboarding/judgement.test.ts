import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideWrite, describeJudgement, judgementFromFlags, parseJudgement } from '../../src/onboarding/judgement.js';
import type { DuplicateHit } from '../../src/governance/dedup.js';

const ACTIVE_DUP: DuplicateHit = { memoryId: 'mem-active', scopeId: 'sc-1', contentHash: 'h', status: 'active' };
const CAND_DUP: DuplicateHit = { memoryId: 'mem-cand', scopeId: 'sc-1', contentHash: 'h', status: 'candidate' };

function judge(over: Record<string, unknown> = {}) {
  return parseJudgement({ verdict: 'keep', confidence: 'high', rationale: '长期有效', ...over });
}

// ---------------------------------------------------------------- 解析与校验

test('parseJudgement：合法 keep，dedupe 默认 merge', () => {
  const j = judge();
  assert.equal(j.verdict, 'keep');
  assert.equal(j.mergeIntoId, null);
  assert.equal(j.confidence, 'high');
  assert.equal(j.rationale, '长期有效');
  assert.equal(j.dedupe, 'merge');
});

test('parseJudgement：merge_into 拆出目标 id', () => {
  const j = judge({ verdict: 'merge_into:abc-123' });
  assert.equal(j.verdict, 'merge_into');
  assert.equal(j.mergeIntoId, 'abc-123');
});

test('parseJudgement：六类非法输入各被拒，且不用默认值补齐', () => {
  const bad: Array<[string, Record<string, unknown>]> = [
    ['verdict 不在集合内', { verdict: 'maybe', confidence: 'high', rationale: 'x' }],
    ['verdict 缺失', { confidence: 'high', rationale: 'x' }],
    ['merge_into 无目标', { verdict: 'merge_into:', confidence: 'high', rationale: 'x' }],
    ['confidence 缺失', { verdict: 'keep', rationale: 'x' }],
    ['confidence 非法', { verdict: 'keep', confidence: 'certain', rationale: 'x' }],
    ['rationale 为空', { verdict: 'keep', confidence: 'high', rationale: '   ' }],
  ];
  for (const [label, raw] of bad) {
    assert.throws(() => parseJudgement(raw), /E_VALIDATION|verdict|confidence|rationale|merge_into/i, label);
  }
});

test('parseJudgement：dedupe 非法被拒；keep_both 与 merge_into 互斥', () => {
  assert.throws(() => judge({ dedupe: 'replace' }), /dedupe/);
  assert.throws(() => judge({ verdict: 'merge_into:m1', dedupe: 'keep_both' }), /互斥/);
});

test('parseJudgement：rationale 超长被拒', () => {
  assert.throws(() => judge({ rationale: 'a'.repeat(501) }), /上限/);
});

test('parseJudgement：非对象与 null 被拒', () => {
  assert.throws(() => parseJudgement(null), /E_VALIDATION|不能为空/);
  assert.throws(() => parseJudgement('keep'), /必须是对象/);
  assert.throws(() => parseJudgement(['keep']), /必须是对象/);
});

// ---------------------------------------------------------------- CLI 拼装

test('judgementFromFlags：未给 --judgement 返回 null（不是默认判断）', () => {
  assert.equal(judgementFromFlags({}), null);
  assert.equal(judgementFromFlags({ judgement: true }), null, '布尔误用不得变成判断');
});

test('judgementFromFlags：四个标志拼成对象', () => {
  const j = judgementFromFlags({
    judgement: 'skip',
    confidence: 'low',
    rationale: '与既有条目重复表述',
    dedupe: 'merge',
  });
  assert.equal(j?.verdict, 'skip');
  assert.equal(j?.confidence, 'low');
});

test('judgementFromFlags：缺 rationale 时在解析层被拒，而不是被静默接受', () => {
  assert.throws(() => judgementFromFlags({ judgement: 'skip', confidence: 'high' }), /rationale/);
});

// ---------------------------------------------------------------- 写入决策

test('decideWrite：无判断无重复 → insert', () => {
  const d = decideWrite({ judgement: null, duplicate: null });
  assert.equal(d.action, 'insert');
  assert.equal(d.basis, 'no_duplicate');
});

test('decideWrite：无判断但有 active 重复 → merge（写入路径的查重不依赖判断）', () => {
  const d = decideWrite({ judgement: null, duplicate: ACTIVE_DUP });
  assert.equal(d.action, 'merge');
  assert.equal(d.targetMemoryId, 'mem-active');
});

test('decideWrite：无判断但命中候选 → 晋升候选而不是新建', () => {
  const d = decideWrite({ judgement: null, duplicate: CAND_DUP });
  assert.equal(d.action, 'promote_candidate');
  assert.equal(d.targetMemoryId, 'mem-cand');
});

test('decideWrite：skip + high → 不写库', () => {
  const d = decideWrite({ judgement: judge({ verdict: 'skip' }), duplicate: null });
  assert.equal(d.action, 'skip');
  assert.equal(d.targetMemoryId, null);
});

test('decideWrite：skip + 低置信且无重复 → 降为候选而不是丢弃', () => {
  for (const confidence of ['medium', 'low']) {
    const d = decideWrite({ judgement: judge({ verdict: 'skip', confidence }), duplicate: null });
    assert.equal(d.action, 'candidate', `confidence=${confidence} 不得直接丢弃`);
  }
});

test('decideWrite：skip + 低置信但已有 active → 并入既有，不新建也不丢既有', () => {
  const d = decideWrite({ judgement: judge({ verdict: 'skip', confidence: 'low' }), duplicate: ACTIVE_DUP });
  assert.equal(d.action, 'merge');
  assert.equal(d.targetMemoryId, 'mem-active');
});

test('decideWrite：keep 命中 active 重复 → merge', () => {
  const d = decideWrite({ judgement: judge(), duplicate: ACTIVE_DUP });
  assert.equal(d.action, 'merge');
});

test('decideWrite：keep_both 显式要求并存 → insert，即便已有同内容', () => {
  const d = decideWrite({ judgement: judge({ dedupe: 'keep_both' }), duplicate: ACTIVE_DUP });
  assert.equal(d.action, 'insert');
  assert.equal(d.basis, 'judgement_keep_both');
});

test('decideWrite：merge_into 指向显式目标', () => {
  const d = decideWrite({ judgement: judge({ verdict: 'merge_into:chosen-1' }), duplicate: ACTIVE_DUP });
  assert.equal(d.action, 'merge');
  assert.equal(d.targetMemoryId, 'chosen-1', '显式目标优先于查重命中项');
});

test('describeJudgement：审计描述含结论、置信度与去重意图', () => {
  assert.equal(describeJudgement(judge()), 'keep/high/merge');
  assert.equal(describeJudgement(judge({ verdict: 'merge_into:m9' })), 'merge_into→m9/high/merge');
});
