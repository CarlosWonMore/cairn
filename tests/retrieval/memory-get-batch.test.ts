import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppService } from '../../src/interfaces/app-service.js';
import { openStore } from '../../src/store/open.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';
import { isCairnError } from '../../src/core/errors.js';

/**
 * add-two-stage-memory-recall D3/D4：memory_get 支持唯一前缀（≥8 字符，歧义报候选）
 * 与批量 ids（上限 10）；批量逐条作用域检查，不可读条目只返回标记不带正文。
 * 单条读取的作用域检查语义（agent 通道 scopeAllowsRead）不变。
 */

function setupAgentService() {
  const home = makeTestHome();
  process.env['CAIRN_CHANNEL'] = 'agent';
  const store = openStore({ home });
  const dev = store.identity.deviceId;
  const personal = store.scopes.resolvePreset('personal-global');
  const foreignDev = store.scopes.resolvePreset('device-local', { deviceId: 'device-9' });
  const a = store.memories.add({ kind: 'fact', content: '前缀解析验证记忆甲', scopeId: personal.id, authority: 'user_explicit', createdBy: 'test' }, dev);
  const b = store.memories.add({ kind: 'fact', content: '前缀解析验证记忆乙', scopeId: personal.id, authority: 'user_explicit', createdBy: 'test' }, dev);
  const foreign = store.memories.add({ kind: 'fact', content: '另一台设备的本地专用记忆', scopeId: foreignDev.id, authority: 'user_explicit', createdBy: 'test' }, dev);
  // uuidv7 同毫秒创建的记忆共享前 ≥12 个字符——「8 字符前缀唯一」在新建库上不成立。
  // 这里按库内全部 id 计算 target 的唯一前缀（与其他 id 的公共前缀 +1，下限 8）。
  const allIds = (store.db.all('SELECT id FROM memory') as { id: string }[]).map((r) => r.id);
  const uniqPrefix = (target: string): string => {
    let worst = 0;
    for (const other of allIds) {
      if (other === target) continue;
      let l = 0;
      while (l < 36 && target[l] === other[l]) l++;
      if (l > worst) worst = l;
    }
    return target.slice(0, Math.min(36, Math.max(8, worst + 1)));
  };
  store.close();
  const service = AppService.open(home);
  const cleanup = () => {
    service.close();
    delete process.env['CAIRN_CHANNEL'];
    cleanupTestHome(home);
  };
  return { service, a, b, foreign, uniqPrefix, cleanup };
}

test('get：完整 id 直取不变', () => {
  const { service, a, cleanup } = setupAgentService();
  try {
    const d = service.showMemory(a.id);
    assert.equal(d.memory.id, a.id);
    assert.ok(d.memory.content.includes('前缀解析验证记忆甲'));
  } finally { cleanup(); }
});

test('get：唯一前缀解析到该记忆（长度按库内实际公共前缀确定）', () => {
  const { service, a, uniqPrefix, cleanup } = setupAgentService();
  try {
    const prefix = uniqPrefix(a.id);
    assert.ok(prefix.length >= 8, '前缀至少 8 字符');
    assert.ok(prefix.length < 36, '前缀短于完整 id（否则失去意义）');
    const d = service.showMemory(prefix);
    assert.equal(d.memory.id, a.id);
  } finally { cleanup(); }
});

test('get：短于 8 字符的前缀拒绝', () => {
  const { service, a, cleanup } = setupAgentService();
  try {
    try {
      service.showMemory(a.id.slice(0, 4));
      assert.fail('必须拒绝过短前缀');
    } catch (e) {
      assert.ok(isCairnError(e));
    }
  } finally { cleanup(); }
});

test('get：歧义前缀报候选完整标识，不猜测', () => {
  const { service, a, b, cleanup } = setupAgentService();
  try {
    // 两条 uuidv7 同毫秒生成时共享 ≥12 个前缀字符；找出实际公共前缀长度。
    let len = 8;
    while (len < 36 && a.id.slice(0, len) === b.id.slice(0, len)) len += 1;
    const shared = len - 1;
    if (shared < 8) return; // 两条 id 在 8 字符内就分叉（跨毫秒极端情况）：构造不出歧义，跳过
    try {
      service.showMemory(a.id.slice(0, shared));
      assert.fail('歧义前缀必须拒绝');
    } catch (e) {
      assert.ok(isCairnError(e));
      const details = (e as { details?: { candidates?: string[] } }).details;
      assert.ok(Array.isArray(details?.candidates) && details!.candidates!.length >= 2, '错误要带候选完整标识');
    }
  } finally { cleanup(); }
});

test('get：不存在的 id 报 E_NOT_FOUND', () => {
  const { service, cleanup } = setupAgentService();
  try {
    try {
      service.showMemory('ffffffffffffffffffffffffffffffff');
      assert.fail('必须报不存在');
    } catch (e) {
      assert.ok(isCairnError(e));
      assert.equal((e as { code?: string }).code, 'E_NOT_FOUND');
    }
  } finally { cleanup(); }
});

test('get 批量：可读条目返回完整详情，不可读只返回 readable:false 不带正文', () => {
  const { service, a, b, foreign, uniqPrefix, cleanup } = setupAgentService();
  try {
    const out = service.showMemories([uniqPrefix(a.id), b.id, foreign.id, 'ffffffffffffffffffffffffffffffff']);
    assert.equal(out.results.length, 4);
    const first = out.results[0] as { id: string; memory: { id: string } };
    assert.equal(first.id, a.id);
    assert.equal(first.memory.id, a.id);
    assert.ok('memory' in first);
    const foreignEntry = out.results[2] as { id: string; readable?: boolean; memory?: unknown };
    assert.equal(foreignEntry.id, foreign.id);
    assert.equal(foreignEntry.readable, false, '不可读条目显式标记');
    assert.ok(!('memory' in foreignEntry), '不可读条目不携带详情对象');
    assert.ok(!JSON.stringify(foreignEntry).includes('本地专用记忆'), '不可读条目不泄露正文');
    const missing = out.results[3] as { id: string; error?: string };
    assert.ok(missing.error, '不存在条目显式报错');
    assert.ok(!JSON.stringify(missing).includes('正文'), '报错条目无内容');
  } finally { cleanup(); }
});

test('get 批量：超过 10 条拒绝', () => {
  const { service, a, cleanup } = setupAgentService();
  try {
    const ids = Array.from({ length: 11 }, () => a.id);
    try {
      service.showMemories(ids);
      assert.fail('批量必须拒绝超限');
    } catch (e) {
      assert.ok(isCairnError(e));
    }
  } finally { cleanup(); }
});
