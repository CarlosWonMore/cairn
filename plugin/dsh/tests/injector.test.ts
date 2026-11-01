/**
 * 插件入口测试。
 *
 * 重点锁死踩过三次的形状问题：默认导出必须是**插件对象**而不是工厂函数。
 * Cordis 见 `typeof plugin === 'function'` 会把它当 apply 调用并传入 ctx，
 * 导致 `cannot get property "..." without inject`，插件状态 failed。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import defaultExport, { apply, inject, name } from '../src/index.js';

describe('插件形状（踩过三次的坑）', () => {
  it('默认导出必须是对象，不能是函数', () => {
    assert.equal(typeof defaultExport, 'object', '工厂函数会被 Cordis 当 apply 调用，把 ctx 误当参数');
    assert.equal(typeof defaultExport.apply, 'function');
    assert.equal(typeof defaultExport.name, 'string');
    assert.ok(Array.isArray(defaultExport.inject));
  });

  it('模块级导出 name / inject / apply', () => {
    assert.equal(name, 'cairn-dsh-memory');
    assert.ok(inject.includes('tools'), '不声明 tools 就拿不到 ctx.tools');
    assert.equal(typeof apply, 'function');
  });

  it('apply 接受 (ctx, config) 两个参数，不读 ctx.config', () => {
    assert.equal(apply.length >= 1, true);
    const events: string[] = [];
    const ctx = {
      tools: { call: async () => ({ content: [{ text: '{"items":[]}' }] }) },
      on: (e: string) => events.push(e),
    };
    assert.doesNotThrow(() => apply(ctx, { enabled: true }), 'config 从第二参数取，读 ctx.config 会抛');
    assert.deepEqual(events, ['session/event', 'agent/pre-step']);
  });

  it('拿不到 tools 服务时钩子照常注册、召回降级为空（2026-11-02 契约变更）', async () => {
    // 第四轮面板排查：无 tools 时提前 return 会导致 usage 路由与 pre-step
    // 钩子全部丢失（面板不可见的直接根因）——现在钩子必须注册，召回降级。
    const events: string[] = [];
    let preStep: ((p: unknown, n?: () => unknown) => Promise<unknown>) | null = null;
    apply({
      on: (e: string, fn: unknown) => { events.push(e); if (e === 'agent/pre-step') preStep = fn as typeof preStep; },
    }, {});
    assert.deepEqual(events, ['session/event', 'agent/pre-step'], '钩子必须注册');
    if (preStep) {
      const injected: unknown[] = [];
      await preStep({ agent: { inject: (m: unknown) => injected.push(m) } }, () => {});
      assert.equal(injected.length, 0, '无 tools 时召回降级为空，不注入');
    }
  });

  it('ctx.on 抛错时不向外冒泡', () => {
    const ctx = {
      tools: { call: async () => ({ content: [{ text: '{}' }] }) },
      on: () => { throw new Error('注册失败'); },
    };
    assert.doesNotThrow(() => apply(ctx, {}));
  });

  it('pre-step 处理器调用 next()，否则链路卡住', async () => {
    let handler: ((p: unknown, n?: () => unknown) => Promise<unknown>) | null = null;
    const ctx = {
      tools: { call: async () => ({ content: [{ text: '{"items":[]}' }] }) },
      on: (e: string, fn: unknown) => { if (e === 'agent/pre-step') handler = fn as typeof handler; },
    };
    apply(ctx, {});
    assert.ok(handler);
    let called = false;
    await handler!({ agent: { inject: () => {} } }, () => { called = true; });
    assert.equal(called, true, 'next() 必须被调用');
  });
});
