/**
 * 注入器集成测试：串起「判定 → 召回 → 过滤 → 渲染 → 记账」。
 *
 * 用 stub 召回实现，不依赖 DSH 宿主——插件的可测部分到此为止，
 * 宿主侧集成只能手工冒烟（design D6）。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createCairnMemoryPlugin, createInjector } from '../src/index.js';
import type { RecallHit } from '../src/recall.js';

function hit(id: string, content: string, extra: Partial<RecallHit> = {}): RecallHit {
  return { id, kind: 'fact', content, ...extra };
}

describe('createInjector', () => {
  it('正常路径：召回命中即产出注入文本', async () => {
    const inj = createInjector({
      recall: async () => [hit('a', '投影预算是 2KB')],
      config: { budgetBytes: 2048 },
    });
    const out = await inj.runOnce('投影预算怎么算的？');
    assert.equal(out.injected, true);
    assert.ok(out.text.includes('投影预算是 2KB'));
  });

  it('召回失败不抛错，只跳过本次注入（降级）', async () => {
    const inj = createInjector({
      recall: async () => { throw new Error('MCP 未连接'); },
    });
    const out = await inj.runOnce('任意足够长的查询文本');
    assert.equal(out.injected, false);
    assert.ok(out.reason.startsWith('recall_failed'));
  });

  it('关闭时完全不召回', async () => {
    let called = 0;
    const inj = createInjector({
      recall: async () => { called++; return [hit('a', '内容')]; },
      config: { enabled: false },
    });
    const out = await inj.runOnce('任意足够长的查询文本');
    assert.equal(out.injected, false);
    assert.equal(called, 0, '关闭时不应发起召回');
  });

  it('敏感命中被过滤掉，不进入注入', async () => {
    const inj = createInjector({
      recall: async () => [
        hit('a', '可以注入的普通内容'),
        hit('b', '不该出现的敏感内容', { sensitivity: 'sensitive' }),
      ],
      config: { budgetBytes: 2048 },
    });
    const out = await inj.runOnce('足够长的查询文本内容');
    assert.ok(out.text.includes('可以注入的普通内容'));
    assert.ok(!out.text.includes('不该出现的敏感内容'));
  });

  it('同一记忆第二次不再注入（会话内去重）', async () => {
    const inj = createInjector({
      recall: async () => [hit('a', '同一条记忆内容')],
      config: { budgetBytes: 2048 },
    });
    const first = await inj.runOnce('第一次足够长的查询');
    assert.equal(first.injected, true);
    const second = await inj.runOnce('第二次足够长的查询');
    assert.equal(second.injected, false, '已注入过的不应重复');
  });

  it('resetSession 后可再次注入（压缩后重置）', async () => {
    const inj = createInjector({
      recall: async () => [hit('a', '同一条记忆内容')],
      config: { budgetBytes: 2048 },
    });
    await inj.runOnce('第一次足够长的查询');
    inj.resetSession();
    const again = await inj.runOnce('第二次足够长的查询');
    assert.equal(again.injected, true);
  });
});

describe('createCairnMemoryPlugin：降级行为', () => {
  it('没有召回实现时不注册任何钩子（纯降级）', () => {
    const events: string[] = [];
    const plugin = createCairnMemoryPlugin({});
    plugin.apply({ on: (e: string) => events.push(e) });
    assert.deepEqual(events, [], '没有 MCP 时不应注册 pre-step');
  });

  it('有召回实现且宿主提供 ctx.on 时注册 pre-step', () => {
    const events: string[] = [];
    const plugin = createCairnMemoryPlugin({
      recall: async () => [hit('a', '内容')],
    });
    plugin.apply({ on: (e: string) => events.push(e) });
    assert.deepEqual(events, ['agent/pre-step']);
  });

  it('宿主 ctx 缺失时不抛错', () => {
    const plugin = createCairnMemoryPlugin({ recall: async () => [] });
    assert.doesNotThrow(() => plugin.apply(undefined));
  });
});
