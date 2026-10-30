import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTestHome, cleanupTestHome } from '../helpers.js';
import {
  CONFIDENCE_SCORE,
  evaluatePolicy,
  listPolicies,
  loadPolicy,
  policyHashOf,
  policyPath,
  requireUsablePolicy,
  revokePolicy,
  signPolicy,
  validatePolicySpec,
} from '../../src/onboarding/policy.js';
import type { PolicyCandidate, PolicySpec } from '../../src/onboarding/policy.js';

const BASE: PolicySpec = {
  id: 'default-auto',
  allowedScopes: ['personal-global', 'project-global'],
  maxSensitivity: 'normal',
  requireAiAgreement: true,
  allowCreate: true,
  minConfidence: 0.6,
  note: '首次整理使用',
};

function withHome(fn: (home: string) => void) {
  const home = makeTestHome('cairn-policy-');
  try {
    fn(home);
  } finally {
    cleanupTestHome(home);
  }
}

function cand(over: Partial<PolicyCandidate> = {}): PolicyCandidate {
  return {
    itemId: 'item-1',
    scanState: 'clean',
    scope: 'personal-global',
    sensitivity: 'normal',
    hasConflict: false,
    ruleAction: 'promote',
    aiAction: 'promote',
    aiConfidence: CONFIDENCE_SCORE.high,
    isDuplicate: false,
    wouldCreate: true,
    ...over,
  };
}

// ---------------------------------------------------------------- 签发与哈希

test('签发后读回一致，哈希以规范化内容为准', () => {
  withHome((home) => {
    const signed = signPolicy(home, BASE, { via: 'cli' });
    assert.equal(signed.policyHash, policyHashOf(BASE));
    assert.equal(signed.revokedAt, null);
    const loaded = loadPolicy(home, BASE.id);
    assert.deepEqual(loaded.spec, BASE);
    assert.equal(loaded.policyHash, signed.policyHash);
  });
});

test('字段顺序与数组书写顺序不影响哈希', () => {
  const a: PolicySpec = { ...BASE };
  const b: PolicySpec = {
    note: BASE.note,
    minConfidence: BASE.minConfidence,
    allowCreate: BASE.allowCreate,
    requireAiAgreement: BASE.requireAiAgreement,
    maxSensitivity: BASE.maxSensitivity,
    allowedScopes: [...BASE.allowedScopes],
    id: BASE.id,
  };
  assert.equal(policyHashOf(a), policyHashOf(b));
});

test('改动任一字段都会改变哈希', () => {
  const base = policyHashOf(BASE);
  const variants: Array<Partial<PolicySpec>> = [
    { note: '首次整理使用。' },
    { allowedScopes: ['personal-global'] },
    { maxSensitivity: 'sensitive' },
    { requireAiAgreement: false },
    { allowCreate: false },
    { minConfidence: 0.5 },
  ];
  for (const v of variants) {
    assert.notEqual(policyHashOf({ ...BASE, ...v }), base, `改动 ${JSON.stringify(v)} 应改变哈希`);
  }
});

test('文件被改动后读取即拒绝，不降级使用', () => {
  withHome((home) => {
    signPolicy(home, BASE, { via: 'cli' });
    const file = policyPath(home, BASE.id);
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    (parsed['spec'] as Record<string, unknown>)['maxSensitivity'] = 'sensitive';
    writeFileSync(file, JSON.stringify(parsed), 'utf8');
    assert.throws(() => loadPolicy(home, BASE.id), /哈希不一致|重新签发/);
    assert.throws(() => requireUsablePolicy(home, BASE.id), /哈希不一致|重新签发/);
  });
});

test('重复签发同一 id 需显式 force', () => {
  withHome((home) => {
    signPolicy(home, BASE, { via: 'cli' });
    assert.throws(() => signPolicy(home, BASE, { via: 'cli' }), /已存在|force/);
    const replaced = signPolicy(home, { ...BASE, note: '改意' }, { via: 'cli', force: true });
    assert.equal(loadPolicy(home, BASE.id).spec.note, '改意');
    assert.equal(replaced.spec.note, '改意');
  });
});

test('撤销后不可使用，可被重新签发覆盖', () => {
  withHome((home) => {
    signPolicy(home, BASE, { via: 'console' });
    const revoked = revokePolicy(home, BASE.id);
    assert.ok(revoked.revokedAt);
    assert.throws(() => requireUsablePolicy(home, BASE.id), /撤销/);
    // loadPolicy 仍可读（要能查历史），只是不可用
    assert.equal(loadPolicy(home, BASE.id).revokedAt, revoked.revokedAt);
  });
});

test('列表只含可解析的策略文件', () => {
  withHome((home) => {
    signPolicy(home, BASE, { via: 'cli' });
    signPolicy(home, { ...BASE, id: 'second' }, { via: 'cli' });
    writeFileSync(join(home, 'policy', 'broken.json'), '{ 不是 json', 'utf8');
    const ids = listPolicies(home).map((p) => p.spec.id);
    assert.deepEqual(ids, ['default-auto', 'second']);
  });
});

// ---------------------------------------------------------------- 严格校验

test('缺字段、未知字段、空集合、非法值一律拒绝签发', () => {
  const cases: Array<[string, unknown]> = [
    ['缺 allowedScopes', { ...BASE, allowedScopes: undefined }],
    ['空 allowedScopes', { ...BASE, allowedScopes: [] }],
    ['未知字段（拼写错误）', { ...BASE, allowedScope: ['personal-global'] }],
    ['非法 id', { ...BASE, id: 'Bad_ID' }],
    ['maxSensitivity 非法', { ...BASE, maxSensitivity: 'high' }],
    ['requireAiAgreement 是字符串', { ...BASE, requireAiAgreement: 'true' }],
    ['minConfidence 越界', { ...BASE, minConfidence: 1.5 }],
    ['minConfidence 是字符串', { ...BASE, minConfidence: '0.6' }],
    ['note 缺失', { ...BASE, note: undefined }],
    ['非对象', 'default-auto'],
  ];
  for (const [label, raw] of cases) {
    assert.throws(() => validatePolicySpec(raw), /E_GOVERNANCE|策略|allowedScopes|非法|必须|未知字段/, label);
  }
});

// ---------------------------------------------------------------- 条件判定

test('全部条件满足 → 放行', () => {
  withHome((home) => {
    const p = signPolicy(home, BASE, { via: 'cli' });
    const v = evaluatePolicy(cand(), p);
    assert.equal(v.ok, true);
    assert.equal(v.failedCondition, null);
  });
});

test('八种条件各自失败，且指出具体条件', () => {
  withHome((home) => {
    const p = signPolicy(home, BASE, { via: 'cli' });
    const cases: Array<[PolicyCandidate, string]> = [
      [cand({ scanState: 'blocked' }), 'scan_state'],
      [cand({ scope: 'agent-private' }), 'scope'],
      [cand({ sensitivity: 'sensitive' }), 'sensitivity'],
      [cand({ hasConflict: true }), 'conflict'],
      [cand({ aiAction: 'skip' }), 'ai_agreement'],
      [cand({ aiAction: null }), 'ai_agreement'],
      [cand({ aiConfidence: 0.2 }), 'confidence'],
    ];
    for (const [c, expected] of cases) {
      const v = evaluatePolicy(c, p);
      assert.equal(v.ok, false, `${expected} 应失败`);
      assert.equal(v.failedCondition, expected);
    }
  });
});

test('重复与新建许可分别受 allowCreate 约束', () => {
  withHome((home) => {
    const strict = signPolicy(home, { ...BASE, id: 'no-create', allowCreate: false }, { via: 'cli' });
    assert.equal(evaluatePolicy(cand({ isDuplicate: true }), strict).failedCondition, 'duplicate');
    assert.equal(evaluatePolicy(cand({ wouldCreate: true }), strict).failedCondition, 'create');
    // 并入既有记忆不需要新建许可
    assert.equal(evaluatePolicy(cand({ wouldCreate: false, isDuplicate: true }), strict).failedCondition, 'duplicate');
  });
});

test('条件顺序：敏感度超限时根本不看 AI 结果（省掉一次无用的模型调用）', () => {
  withHome((home) => {
    const p = signPolicy(home, BASE, { via: 'cli' });
    // AI 结果缺失 + 敏感度超限：应先报 sensitivity
    const v = evaluatePolicy(cand({ sensitivity: 'sensitive', aiAction: null, aiConfidence: null }), p);
    assert.equal(v.failedCondition, 'sensitivity');
  });
});

test('条件顺序：作用域不在白名单时先于敏感度失败', () => {
  withHome((home) => {
    const p = signPolicy(home, BASE, { via: 'cli' });
    const v = evaluatePolicy(cand({ scope: 'agent-private', sensitivity: 'sensitive' }), p);
    assert.equal(v.failedCondition, 'scope');
  });
});

test('requireAiAgreement=false 时不要求 AI 判断（否则开关形同虚设）', () => {
  withHome((home) => {
    const p = signPolicy(home, { ...BASE, requireAiAgreement: false }, { via: 'cli' });
    // 完全没有 AI 判断也应放行——手动签的策略可以只依赖规则层
    assert.equal(evaluatePolicy(cand({ aiAction: null, aiConfidence: null }), p).ok, true);
    // 但有判断且置信度低时仍然拦下
    assert.equal(evaluatePolicy(cand({ aiAction: 'promote', aiConfidence: 0.1 }), p).failedCondition, 'confidence');
  });
});
