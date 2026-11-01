/**
 * 投影简报测试（变更 add-memory-projection-brief）。
 *
 * 重点锁死两条不变量：
 * 1. 敏感内容在**取数阶段**就排除（local_only / sensitive / blocked）；
 * 2. 同输入必然同字节（不含时间戳等易变值）。
 */

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import {
  buildProjection,
  renderProjection,
  selectProjectionCandidates,
  type ProjectionCandidate,
} from '../../src/projection/brief.js';
import { openStore, type CairnStore } from '../../src/store/open.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';

let store: CairnStore;
let home: string;

function addMemory(content: string, opts: { scopeId?: string; sensitivity?: string; authority?: string } = {}) {
  const scopeId = opts.scopeId ?? store.scopes.resolvePreset('personal-global').id;
  return store.memories.add(
    {
      kind: 'fact',
      content,
      authority: (opts.authority ?? 'user_explicit') as never,
      scopeId,
      createdBy: 'test',
      sensitivity: (opts.sensitivity ?? 'normal') as never,
    } as never,
    store.identity.deviceId,
  );
}

before(() => {
  home = makeTestHome();
  store = openStore({ home, allowUninitialized: true } as never);
});

after(() => {
  try { store.close(); } catch { /* ignore */ }
  cleanupTestHome(home);
});

describe('敏感排除（取数阶段）', () => {
  it('sensitive 记忆不进入候选', () => {
    const personal = store.scopes.resolvePreset('personal-global').id;
    addMemory('普通内容 A', { scopeId: personal });
    addMemory('敏感内容 B', { scopeId: personal, sensitivity: 'sensitive' });
    const { candidates } = selectProjectionCandidates(store, { scopeIds: [personal] });
    assert.ok(candidates.some((c) => c.content.includes('普通内容 A')));
    assert.ok(!candidates.some((c) => c.content.includes('敏感内容 B')), 'sensitive 必须被排除');
  });

  it('local_only 作用域的记忆不进入候选', () => {
    const personal = store.scopes.resolvePreset('personal-global').id;
    const dev = store.scopes.resolvePreset('device-local', { deviceId: store.identity.deviceId }).id;
    addMemory('全局内容 C', { scopeId: personal });
    addMemory('本机内容 D', { scopeId: dev });
    const { candidates } = selectProjectionCandidates(store, { scopeIds: [personal, dev] });
    assert.ok(candidates.some((c) => c.content.includes('全局内容 C')));
    assert.ok(!candidates.some((c) => c.content.includes('本机内容 D')), 'local_only 必须被排除');
  });

  it('排除计数可见，但不泄露内容', () => {
    const personal = store.scopes.resolvePreset('personal-global').id;
    addMemory('可投影 E', { scopeId: personal });
    addMemory('不该出现 F', { scopeId: personal, sensitivity: 'sensitive' });
    const r = buildProjection(store, { scopeIds: [personal], mode: 'brief', budgetBytes: 4096 });
    assert.ok(r.excludedCount >= 1);
    assert.ok(!r.text.includes('不该出现 F'));
  });
});

describe('字节可复现', () => {
  it('同一记忆集两次渲染逐字节相同', () => {
    const personal = store.scopes.resolvePreset('personal-global').id;
    addMemory('稳定性测试内容 G', { scopeId: personal });
    const a = buildProjection(store, { scopeIds: [personal], mode: 'brief', budgetBytes: 4096 });
    const b = buildProjection(store, { scopeIds: [personal], mode: 'brief', budgetBytes: 4096 });
    assert.equal(a.text, b.text, '同输入必须同字节');
    assert.equal(a.bytes, b.bytes);
  });

  it('渲染结果不含时间戳式易变值', () => {
    const cands: ProjectionCandidate[] = [
      { id: 'aaaaaaaa-1111-2222-3333-444444444444', kind: 'fact', content: '内容 H', confidence: 0.9, updatedAt: '2026-01-01T00:00:00.000Z' },
    ];
    const r = renderProjection(cands, { mode: 'brief', budgetBytes: 4096 });
    assert.ok(!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(r.text), '不得出现 ISO 时间戳');
  });
});

describe('预算与截断', () => {
  it('超预算时裁剪并写明省略条数', () => {
    const cands: ProjectionCandidate[] = Array.from({ length: 50 }, (_, i) => ({
      id: `id-${String(i).padStart(12, '0')}`,
      kind: 'fact',
      content: `这是一条用于撑爆预算的记忆内容，编号 ${i}，需要足够长才能触发截断逻辑。`,
      confidence: 0.5,
      updatedAt: '2026-01-01T00:00:00.000Z',
    }));
    const r = renderProjection(cands, { mode: 'brief', budgetBytes: 600 });
    assert.ok(r.bytes <= 600, `字节数 ${r.bytes} 必须 <= 600`);
    assert.ok(r.truncated > 0, '必须有被裁掉的条目');
    assert.ok(/另 \d+ 条未显示/.test(r.text), '必须明示省略条数');
  });

  it('预算内不出现省略提示', () => {
    const cands: ProjectionCandidate[] = [
      { id: 'aaaaaaaa-0000-0000-0000-000000000000', kind: 'fact', content: '短内容', confidence: 0.9, updatedAt: '2026-01-01T00:00:00.000Z' },
    ];
    const r = renderProjection(cands, { mode: 'brief', budgetBytes: 4096 });
    assert.equal(r.truncated, 0);
    assert.ok(!r.text.includes('未显示'));
  });

  it('任意预算下输出字节都不得超过预算（含省略提示本身）', () => {
    const cands: ProjectionCandidate[] = Array.from({ length: 40 }, (_, i) => ({
      id: 'id-' + String(i).padStart(12, '0'),
      kind: 'fact',
      content: '用于预算边界测试的记忆条目编号 ' + i + '，内容长度需要足够触发截断。',
      confidence: 0.5,
      updatedAt: '2026-01-01T00:00:00.000Z',
    }));
    for (const budget of [80, 150, 300, 600, 1200, 2048, 8192]) {
      const r = renderProjection(cands, { mode: 'brief', budgetBytes: budget });
      const actual = Buffer.byteLength(r.text, 'utf8');
      assert.ok(actual <= budget, `预算 ${budget} 下实际 ${actual} 超限`);
    }
  });

  it('非法预算被拒绝', () => {
    assert.throws(() => renderProjection([], { mode: 'brief', budgetBytes: -1 }), /E_VALIDATION|budgetBytes/);
  });
});

describe('lesson 优先', () => {
  it('预算紧张时优先保留 lesson 类型', () => {
    const personal = store.scopes.resolvePreset('personal-global').id;
    // 低 confidence 的 lesson vs 高 confidence 的 fact：预算只够一条时保留 lesson
    const lesson = store.memories.add(
      { kind: 'lesson', content: '曾经这样做错了：不该用 RmRebuild', authority: 'user_explicit', scopeId: personal, createdBy: 'test', confidence: 0.1 } as never,
      store.identity.deviceId,
    );
    store.memories.add(
      { kind: 'fact', content: '一条普通的置信度很高的事实内容', authority: 'user_explicit', scopeId: personal, createdBy: 'test', confidence: 1 } as never,
      store.identity.deviceId,
    );
    const r = buildProjection(store, { scopeIds: [personal], mode: 'brief', budgetBytes: 240 });
    assert.ok(r.text.includes('不该用 RmRebuild'), 'lesson 必须优先于高置信度 fact 保留');
    void lesson;
  });
});

describe('两种渲染模式', () => {
  it('brief 模式含 kind 与 id 前缀', () => {
    const r = renderProjection(
      [{ id: 'abcdef12-3456-7890-0000-000000000000', kind: 'fact', content: '内容 I', confidence: 1, updatedAt: '2026-01-01T00:00:00.000Z' }],
      { mode: 'brief', budgetBytes: 4096 },
    );
    assert.ok(r.text.includes('[fact]'));
    assert.ok(r.text.includes('id:abcdef12'));
  });

  it('index 模式单行不超过 200 字符', () => {
    const long = '很长的内容'.repeat(100);
    const r = renderProjection(
      [{ id: 'aaaaaaaa-0000-0000-0000-000000000000', kind: 'fact', content: long, confidence: 1, updatedAt: '2026-01-01T00:00:00.000Z' }],
      { mode: 'index', budgetBytes: 4096 },
    );
    for (const line of r.text.split('\n')) {
      assert.ok(line.length <= 200, `行长度 ${line.length} 超过 200`);
    }
  });
});
