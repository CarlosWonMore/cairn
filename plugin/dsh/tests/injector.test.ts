/**
 * 插件入口测试。
 *
 * 重点锁死踩过三次的形状问题：默认导出必须是**插件对象**而不是工厂函数。
 * Cordis 见 `typeof plugin === 'function'` 会把它当 apply 调用并传入 ctx，
 * 导致 `cannot get property "..." without inject`，插件状态 failed。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import defaultExport, { apply, deriveQueries, extractStepText, extractText, inject, name } from '../src/index.js';

/** 构造一个带 tools 间谍的 ctx：记录 recall 查询词，返回一条固定命中；
 *  同时捕获 webServer 注册（同一 apply 实例内读活动记录，避免跨实例假通过）。 */
function makeSpyCtx() {
  const queries: string[] = [];
  const injected: unknown[] = [];
  let captured: { handler?: (req: unknown, res: unknown) => void } | null = null;
  const ctx = {
    tools: {
      call: async (_name: string, args: { query: string }) => {
        queries.push(args.query);
        return {
          content: [{
            text: JSON.stringify({ items: [{ id: 'm1', kind: 'fact', content: '投影预算是 2KB' }] }),
          }],
        };
      },
    },
    webServer: { register: (o: unknown) => { captured = o as typeof captured; } },
    on: (e: string, fn: unknown) => { (ctx as Record<string, unknown>)[e] = fn; },
  };
  function readUsage(url = '/plugins/cairn-dsh-memory/usage?history=1'): Record<string, unknown> {
    let body = '';
    captured!.handler!({ method: 'GET', url }, { writeHead: () => {}, end: (b: string) => { body = b; } });
    return JSON.parse(body) as Record<string, unknown>;
  }
  return { ctx, queries, injected, readUsage };
}

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
    assert.deepEqual(events, ['session/event', 'tools/post-execute', 'agent/pre-step']);
  });

  it('拿不到 tools 服务时钩子照常注册、召回降级为空（2026-11-02 契约变更）', async () => {
    // 第四轮面板排查：无 tools 时提前 return 会导致 usage 路由与 pre-step
    // 钩子全部丢失（面板不可见的直接根因）——现在钩子必须注册，召回降级。
    const events: string[] = [];
    let preStep: ((p: unknown, n?: () => unknown) => Promise<unknown>) | null = null;
    apply({
      on: (e: string, fn: unknown) => { events.push(e); if (e === 'agent/pre-step') preStep = fn as typeof preStep; },
    }, {});
    assert.deepEqual(events, ['session/event', 'tools/post-execute', 'agent/pre-step'], '钩子必须注册');
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

  it('usage 端点兜底形状字段完备（2026-11-02：退化形状害 client 详情段崩溃）', () => {
    let captured: { handler?: (req: unknown, res: unknown) => void } | null = null;
    const ctx = {
      // 不给 tools（降级路径也要注册路由），用 path-2（直接 webServer 属性）捕获 handler
      webServer: { register: (o: unknown) => { captured = o as typeof captured; } },
      on: () => {},
    };
    apply(ctx, {});
    assert.ok(captured!.handler, 'usage 路由必须注册成功');
    let body = '';
    captured!.handler!({ method: 'GET' }, { writeHead: () => {}, end: (b: string) => { body = b; } });
    const parsed = JSON.parse(body) as Record<string, unknown>;
    // client 详情段读这些字段，缺一个就崩（宿主 crash boundary 会卸载整个面板）
    for (const k of ['status', 'label', 'candidates', 'injected', 'matchedBy', 'bytesUsed', 'bytesBudget', 'filteredCount']) {
      assert.ok(k in parsed, `缺少字段 ${k}`);
    }
    assert.ok(Array.isArray(parsed.injected), 'injected 必须是数组');
    assert.equal(parsed.status, 'miss');
  });

  it('usage?debug=1 附带摘要级诊断（不含正文）', () => {
    let captured: { handler?: (req: unknown, res: unknown) => void } | null = null;
    apply({
      webServer: { register: (o: unknown) => { captured = o as typeof captured; } },
      on: () => {},
    }, {});
    let body = '';
    captured!.handler!({ method: 'GET', url: '/plugins/cairn-dsh-memory/usage?debug=1' },
      { writeHead: () => {}, end: (b: string) => { body = b; } });
    const parsed = JSON.parse(body) as { debug?: { lastPreStep?: { fired?: boolean } } };
    assert.ok(parsed.debug, 'debug=1 必须返回诊断');
    assert.equal(typeof parsed.debug!.lastPreStep!.fired, 'boolean');
    let plain = '';
    captured!.handler!({ method: 'GET', url: '/plugins/cairn-dsh-memory/usage' },
      { writeHead: () => {}, end: (b: string) => { plain = b; } });
    assert.ok(!('debug' in JSON.parse(plain)), '不带 debug=1 不返回诊断');
  });

  it('pre-step 真实形状（payload.messages）能驱动召回并注入（2026-11-02 asar 实锤修复）', async () => {
    const { ctx, queries, injected } = makeSpyCtx();
    apply(ctx, {});
    const preStep = (ctx as Record<string, unknown>)['agent/pre-step'] as
      (p: unknown, n?: () => unknown) => Promise<unknown>;
    const events = (ctx as Record<string, unknown>)['session/event'];
    assert.ok(preStep && events, '两个钩子都必须注册');
    // 真实形状：waterfall 载荷 { messages, ...position, signal }，不再依赖 session/event 攒消息
    await preStep({
      agent: { inject: (m: unknown) => injected.push(m) },
      messages: [{ role: 'user', content: [{ type: 'text', text: '投影预算是多少' }] }],
    }, () => {});
    assert.ok(queries.includes('投影预算是多少'), '召回必须拿到用户原文（整句路）');
    assert.ok(queries.length > 1, '长句会派生多路短查询（2-gram 等）');
    assert.equal(injected.length, 1, '命中后必须注入');
  });

  it('session/event 真实签名 (session, event)：双参数，事件在第二参', async () => {
    const { ctx, queries, injected } = makeSpyCtx();
    apply(ctx, {});
    const onEvent = (ctx as Record<string, unknown>)['session/event'] as (s: unknown, e: unknown) => void;
    const preStep = (ctx as Record<string, unknown>)['agent/pre-step'] as
      (p: unknown, n?: () => unknown) => Promise<unknown>;
    // asar 实锤：ctx.on("session/event", (session, event) => …)——事件是第二参。
    // Round-8 前旧实现只收一个参数，把 session 对象当事件，永远抓不到 type。
    onEvent({ id: 'session-1' }, { type: 'user/message', data: { content: [{ type: 'text', text: '库入口在哪' }], source: { kind: 'user' } } });
    await preStep({ agent: { inject: (m: unknown) => injected.push(m) } }, () => {});
    assert.ok(queries.includes('库入口在哪'), 'session/event 兜底必须把用户原文带进召回');
    assert.equal(injected.length, 1);
  });

  it('tools/post-execute 留痕：cairn 工具记名、非 cairn 忽略、next 透传', async () => {
    const { ctx, readUsage } = makeSpyCtx();
    apply(ctx, {});
    const onPost = (ctx as Record<string, unknown>)['tools/post-execute'] as
      (exec: unknown, result: unknown, n?: (r?: unknown) => unknown) => Promise<unknown>;
    assert.ok(onPost, 'tools/post-execute 钩子必须注册');
    const result = { ok: 1 };
    const passed = await onPost({ name: 'mcp__cairn__memory_search' }, result, (r?: unknown) => 'next-' + String(r));
    assert.equal(passed, 'next-[object Object]', '必须调用 next 并透传 result');
    await onPost({ name: 'other__tool__x' }, result, () => 'y');

    const parsed = readUsage() as { recent?: { kind: string; summary: string }[] };
    assert.ok(Array.isArray(parsed.recent), 'payload 必须带 recent 活动记录');
    const toolEntries = parsed.recent!.filter((e) => e.kind === 'tool');
    assert.equal(toolEntries.length, 1, '只留痕 cairn 工具');
    assert.match(toolEntries[0].summary, /cairn\.memory_search/);
  });

  it('record.tools=false 时工具调用不留痕（record.recall 同理）', async () => {
    const { ctx, readUsage } = makeSpyCtx();
    apply(ctx, { record: { tools: false, recall: false } });
    const onPost = (ctx as Record<string, unknown>)['tools/post-execute'] as
      (exec: unknown, result: unknown, n?: (r?: unknown) => unknown) => Promise<unknown>;
    await onPost({ name: 'mcp__cairn__memory_add' }, {}, () => {});
    const preStep = (ctx as Record<string, unknown>)['agent/pre-step'] as
      (p: unknown, n?: () => unknown) => Promise<unknown>;
    await preStep({ agent: { inject: () => {} }, messages: [{ role: 'user', content: '投影预算是多少' }] }, () => {});
    const parsed = readUsage() as { recent?: unknown[] };
    assert.equal((parsed.recent ?? []).length, 0, 'record 关闭后不得留痕');
  });

  it('非用户来源（agent-instructions 等）不驱动召回', async () => {
    const { ctx, queries } = makeSpyCtx();
    apply(ctx, {});
    const onEvent = (ctx as Record<string, unknown>)['session/event'] as (e: unknown) => void;
    const preStep = (ctx as Record<string, unknown>)['agent/pre-step'] as
      (p: unknown, n?: () => unknown) => Promise<unknown>;
    onEvent({ type: 'user/message', data: { content: [{ type: 'text', text: '系统指令' }], source: { kind: 'agent-instructions' } } });
    await preStep({ agent: { inject: () => {} } }, () => {});
    assert.deepEqual(queries, [], '非 user 来源不能触发召回');
  });

  it('extractText / extractStepText 的形状兼容', () => {
    assert.equal(extractText('裸字符串'), '裸字符串');
    assert.equal(extractText([{ type: 'text', text: '数组' }, { type: 'text', text: '拼接' }]), '数组 拼接');
    assert.equal(extractText({ text: '单对象' }), '单对象');
    assert.equal(extractText(undefined), '');
    assert.equal(extractStepText({ messages: [{ role: 'assistant', content: '不该取' }, { role: 'user', content: [{ type: 'text', text: '取这条' }] }] }), '取这条');
    assert.equal(extractStepText(null), '');
    assert.equal(extractStepText({ messages: '不是数组' }), '');
  });

  describe('deriveQueries：整句查询在 FTS trigram 下恒 0 的补救（2026-11-02）', () => {
    it('高频 CJK 2-gram 优先入选（LIKE 通道，整句无标点时最可靠）', () => {
      const qs = deriveQueries('帮我从记忆库里拉取一下记忆');
      assert.equal(qs[0], '记忆', `实际 ${JSON.stringify(qs)}`);
      assert.ok(qs.every((q) => q.length <= 24), '所有查询都应是短词');
    });
    it('标点短句入选且各取前 8 字', () => {
      const qs = deriveQueries('投影预算是多少？另外，库入口在哪。');
      assert.ok(qs.includes('投影预算是多少'), JSON.stringify(qs));
      assert.ok(qs.includes('库入口在哪'), JSON.stringify(qs));
    });
    it('去重、上限 6、空串不入选', () => {
      const qs = deriveQueries('记忆。记忆！记忆？');
      assert.equal(new Set(qs).size, qs.length, '必须去重');
      assert.ok(qs.length <= 6);
      assert.ok(qs.includes('记忆'), JSON.stringify(qs));
    });
    it('ASCII 词入选', () => {
      const qs = deriveQueries('检查exfiltrate正则');
      assert.ok(qs.includes('exfiltrate'), JSON.stringify(qs));
    });
    it('多路查询去重合并命中（2-gram 路命中即注入）', async () => {
      const seen: string[] = [];
      const ctx = {
        tools: {
          call: async (_n: string, args: { query: string }) => {
            seen.push(args.query);
            if (args.query !== '记忆') return { content: [{ text: '{"items":[]}' }] };
            return { content: [{ text: JSON.stringify({ items: [{ id: 'm9', kind: 'fact', content: '跨设备共享记忆统一走 Cairn' }] }) }] };
          },
        },
        on: (e: string, fn: unknown) => { (ctx as Record<string, unknown>)[e] = fn; },
      };
      apply(ctx, {});
      const preStep = (ctx as Record<string, unknown>)['agent/pre-step'] as
        (p: unknown, n?: () => unknown) => Promise<unknown>;
      const injected: unknown[] = [];
      await preStep({
        agent: { inject: (m: unknown) => injected.push(m) },
        messages: [{ role: 'user', content: [{ type: 'text', text: '帮我从记忆库里拉取一下记忆' }] }],
      }, () => {});
      assert.ok(seen.length > 1, '应有多个查询路');
      assert.ok(seen.includes('记忆'));
      assert.equal(injected.length, 1, '2-gram 路命中后必须注入');
    });
  });
});
