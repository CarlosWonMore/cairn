import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveOnboardingActive } from '../../src/interfaces/mcp/server.js';

/**
 * fix-onboarding-tool-surface-flip：启动判定失败时 fail-closed 降级（不暴露条件工具）
 * 且必须留下可诊断日志（stderr）；判定本身不抛错。
 */

test('onboarding 工具面判定：doctor 抛错按降级处理并写 stderr 日志', () => {
  const orig = process.stderr.write;
  let captured = '';
  process.stderr.write = ((s: unknown) => {
    captured += String(s);
    return true;
  }) as typeof process.stderr.write;
  try {
    assert.equal(resolveOnboardingActive({ doctor() { throw new Error('db boom'); } }), false);
  } finally {
    process.stderr.write = orig;
  }
  assert.ok(captured.includes('onboarding'), '降级时留有可诊断日志');
});

test('onboarding 工具面判定：clean>0 暴露、clean=0 不暴露', () => {
  const fake = (clean: number) => ({
    doctor: () => ({ counts: { importItems: { clean } } }),
  });
  assert.equal(resolveOnboardingActive(fake(3)), true, '有待整理条目 → 暴露');
  assert.equal(resolveOnboardingActive(fake(0)), false, '无待整理条目 → 不暴露');
});

test('onboarding 工具面判定：counts 缺失按 0 处理（不抛错）', () => {
  assert.equal(resolveOnboardingActive({ doctor: () => ({}) }), false);
});
