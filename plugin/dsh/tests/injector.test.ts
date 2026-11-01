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
    // 需要两个事件：session/event 攒用户消息（pre-step 拿不到原文），pre-step 执行注入。
    assert.deepEqual(events, ['session/event', 'agent/pre-step']);
  });

  it('宿主 ctx 缺失时不抛错', () => {
    const plugin = createCairnMemoryPlugin({ recall: async () => [] });
    assert.doesNotThrow(() => plugin.apply(undefined));
  });
});
describe('插件对象形状：Cordis 兼容性（踩过的坑）', () => {
  it('只暴露 name / inject / apply，不泄露额外属性', () => {
    const plugin = createCairnMemoryPlugin({ recall: async () => [] });
    const keys = Object.keys(plugin).sort();
    assert.deepEqual(keys, ['apply', 'inject', 'name'],
      'Cordis 用 Proxy 拦截 ctx 属性读取，插件对象多暴露一个属性就会被当作服务名解析并抛 cannot get property without inject');
  });

  it('inject 必须声明 tools（调 MCP 工具的前提）', () => {
    const plugin = createCairnMemoryPlugin({});
    assert.ok(Array.isArray(plugin.inject));
    assert.ok(plugin.inject.includes('tools'), '不声明 tools 就拿不到 ctx.tools，插件无法召回');
    for (const dep of plugin.inject) assert.equal(typeof dep, 'string');
  });

  it('pre-step 处理器必须调用 next()，否则会卡住整条链路', async () => {
    let handler: ((p: unknown, n?: () => unknown) => Promise<unknown>) | null = null;
    const plugin = createCairnMemoryPlugin({ recall: async () => [] });
    plugin.apply({ on: (_e: string, fn: unknown) => { handler = fn as typeof handler; } });
    assert.ok(handler, '必须注册 pre-step');
    let called = false;
    await handler!({ message: '足够长的查询' }, () => { called = true; return 'next-result'; });
    assert.equal(called, true, 'next() 必须被调用');
  });

  it('apply 在 ctx.on 抛错时不向外冒泡', () => {
    const plugin = createCairnMemoryPlugin({ recall: async () => [] });
    assert.doesNotThrow(() =>
      plugin.apply({ on: () => { throw new Error('宿主事件注册失败'); } }),
    );
  });
});
describe('注入走 agent.inject（真实 API）', () => {
  it('命中时调用 agent.inject，且消息形状可辨识', async () => {
    let handler: ((p: unknown, n?: () => unknown) => Promise<unknown>) | null = null;
    const plugin = createCairnMemoryPlugin({
      recall: async () => [{ id: 'a', kind: 'fact', content: '投影预算是 2KB' }],
      config: { budgetBytes: 2048 },
    });
    plugin.apply({ on: (_e: string, fn: unknown) => { handler = fn as typeof handler; } });

    const injected: unknown[] = [];
    const payload = {
      message: '投影预算是多少',
      agent: { inject: (m: unknown) => injected.push(m) },
    };
    await handler!(payload, () => undefined);
    assert.equal(injected.length, 1, '命中时必须调用 agent.inject');
    const msg = injected[0] as { source?: { kind?: string } };
    assert.equal(msg.source?.kind, 'cairn-memory-injection', '注入来源必须可辨识，便于会话记录区分');
  });

  it('未命中时不调用 agent.inject', async () => {
    let handler: ((p: unknown, n?: () => unknown) => Promise<unknown>) | null = null;
    const plugin = createCairnMemoryPlugin({ recall: async () => [] });
    plugin.apply({ on: (_e: string, fn: unknown) => { handler = fn as typeof handler; } });
    const injected: unknown[] = [];
    await handler!({ message: '足够长的查询文本', agent: { inject: (m: unknown) => injected.push(m) } }, () => undefined);
    assert.equal(injected.length, 0);
  });

  it('agent 缺失或 inject 非函数时不抛错（降级）', async () => {
    let handler: ((p: unknown, n?: () => unknown) => Promise<unknown>) | null = null;
    const plugin = createCairnMemoryPlugin({ recall: async () => [{ id: 'a', kind: 'fact', content: '内容' }] });
    plugin.apply({ on: (_e: string, fn: unknown) => { handler = fn as typeof handler; } });
    await assert.doesNotReject(() => handler!({ message: '足够长的查询文本' }, () => undefined) as Promise<unknown>);
  });
});
