/**
 * 插件入口测试。
 *
 * 重点锁死踩过三次的形状问题：默认导出必须是**插件对象**而不是工厂函数。
 * Cordis 见 `typeof plugin === 'function'` 会把它当 apply 调用并传入 ctx，
 * 导致 `cannot get property "..." without inject`，插件状态 failed。
 */

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import defaultExport, { ACTIVITY_FILE, apply, deriveQueries, extractStepText, extractText, inject, makeInjectionMessage, name, recallDiag } from '../src/index.js';
import { isStopTerm } from '../src/recall.js';
import { toSummary } from '../src/usage-state.js';

/** 构造一个带 tools 间谍的 ctx：记录 recall 查询词，返回一条固定命中；
 *  同时捕获 webServer 全部路由注册（同一 apply 实例内读活动记录，避免跨实例假通过）。 */
function makeSpyCtx() {
  const queries: string[] = [];
  const injected: unknown[] = [];
  const routes: { path?: string; handler?: (req: unknown, res: unknown) => void }[] = [];
  const ctx = {
    // 真实契约：ctx.tools.get(name, scope) → ToolDefinition，执行方法是 execute(args, exec)。
    // 本部署默认 ptc 呈现，ctx.tools.execute 对非 run_code 的直呼必然被折叠，
    // 所以这里刻意不提供它：主路径若退化回 tools.execute，测试会直接 0 命中。
    tools: {
      get: () => ({
        execute: async (args: { query: string }) => {
          queries.push(args.query);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ items: [{ id: 'm1', kind: 'fact', content: '投影预算是 2KB' }] }),
              },
            ],
          };
        },
      }),
    },
    webServer: { register: (o: unknown) => routes.push(o as { path?: string; handler?: (req: unknown, res: unknown) => void }) },
    on: (e: string, fn: unknown) => { (ctx as Record<string, unknown>)[e] = fn; },
  };
  function handlerFor(path: string): (req: unknown, res: unknown) => void {
    const h = routes.find((r) => r.path === path)?.handler;
    assert.ok(h, `路由 ${path} 必须已注册`);
    return h!;
  }
  function readUsage(url = '/plugins/cairn-dsh-memory/usage?history=1'): Record<string, unknown> {
    let body = '';
    handlerFor('/plugins/cairn-dsh-memory/usage')({ method: 'GET', url }, { writeHead: () => {}, end: (b: string) => { body = b; } });
    return JSON.parse(body) as Record<string, unknown>;
  }
  return { ctx, queries, injected, readUsage, handlerFor };
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
    const routes: { path?: string; handler?: (req: unknown, res: unknown) => void }[] = [];
    const ctx = {
      // 不给 tools（降级路径也要注册路由），用 path-2（直接 webServer 属性）捕获 handler
      webServer: { register: (o: unknown) => routes.push(o as { path?: string; handler?: (req: unknown, res: unknown) => void }) },
      on: () => {},
    };
    apply(ctx, {});
    const usageHandler = routes.find((r) => r.path === '/plugins/cairn-dsh-memory/usage')?.handler;
    assert.ok(usageHandler, 'usage 路由必须注册成功');
    let body = '';
    usageHandler!({ method: 'GET' }, { writeHead: () => {}, end: (b: string) => { body = b; } });
    const parsed = JSON.parse(body) as Record<string, unknown>;
    // client 详情段读这些字段，缺一个就崩（宿主 crash boundary 会卸载整个面板）
    for (const k of ['status', 'label', 'candidates', 'injected', 'matchedBy', 'bytesUsed', 'bytesBudget', 'filteredCount']) {
      assert.ok(k in parsed, `缺少字段 ${k}`);
    }
    assert.ok(Array.isArray(parsed.injected), 'injected 必须是数组');
    assert.equal(parsed.status, 'miss');
  });

  it('usage?debug=1 附带摘要级诊断（不含正文）', () => {
    const routes2: { path?: string; handler?: (req: unknown, res: unknown) => void }[] = [];
    apply({
      webServer: { register: (o: unknown) => routes2.push(o as { path?: string; handler?: (req: unknown, res: unknown) => void }) },
      on: () => {},
    }, {});
    const usageHandler2 = routes2.find((r) => r.path === '/plugins/cairn-dsh-memory/usage')!.handler!;
    let body = '';
    usageHandler2({ method: 'GET', url: '/plugins/cairn-dsh-memory/usage?debug=1' },
      { writeHead: () => {}, end: (b: string) => { body = b; } });
    const parsed = JSON.parse(body) as { debug?: { lastPreStep?: { fired?: boolean } } };
    assert.ok(parsed.debug, 'debug=1 必须返回诊断');
    assert.equal(typeof parsed.debug!.lastPreStep!.fired, 'boolean');
    let plain = '';
    usageHandler2({ method: 'GET', url: '/plugins/cairn-dsh-memory/usage' },
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

  it('自动召回之后，用户手动调用 cairn 工具仍要留痕（压制窗口只该覆盖服务层自调用）', async () => {
    const { ctx, readUsage } = makeSpyCtx();
    apply(ctx, {});
    const preStep = (ctx as Record<string, unknown>)['agent/pre-step'] as
      (p: unknown, n?: () => unknown) => Promise<unknown>;
    // 主路径是定义体直调，不会触发 tools/post-execute，因此不该打开压制窗口；
    // 旧实现在每条查询前都开 3s 窗口，等于每轮把用户手工调用的 cairn 工具吞掉。
    await preStep({ agent: { inject: () => {} }, messages: [{ role: 'user', content: [{ type: 'text', text: '投影预算是多少' }] }] }, () => {});
    const onPost = (ctx as Record<string, unknown>)['tools/post-execute'] as
      (exec: unknown, result: unknown, n?: (r?: unknown) => unknown) => Promise<unknown>;
    await onPost({ name: 'mcp__cairn__memory_search' }, {}, () => {});
    const parsed = readUsage() as { recent?: { kind: string }[] };
    assert.equal(parsed.recent!.filter((e) => e.kind === 'tool').length, 1, '召回后的手工调用必须留痕');
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
    it('虚词二元组不当查询：它们命中什么都正常（2026-11-02 视频会话串味实测）', () => {
      // 重复出现的实义词会被选中；虚词一个都不许当查询。
      const qs = deriveQueries('这个项目要先看项目文档，我们现在可以看一下');
      assert.ok(!qs.includes('可以'), JSON.stringify(qs));
      assert.ok(!qs.includes('这个'), JSON.stringify(qs));
      assert.ok(!qs.includes('我们'), JSON.stringify(qs));
      assert.ok(qs.includes('项目'), `有实义的二字词必须还在，实际 ${JSON.stringify(qs)}`);
      // 不变量：任何入选的二元组都不能是虚词（跨词边界的碎片命中率≈0，无害）。
      for (const q of qs) assert.ok(!isStopTerm(q), `虚词不许当查询：${q}`);
    });
    it('ASCII 词入选', () => {
      const qs = deriveQueries('检查exfiltrate正则');
      assert.ok(qs.includes('exfiltrate'), JSON.stringify(qs));
    });
    it('多路查询去重合并命中（走 definition.execute，2-gram 路命中即注入）', async () => {
      const seen: string[] = [];
      // 真实契约：get(name, scope) → ToolDefinition，执行方法是 execute(args, exec)。
      // 主路径是定义体直调——tools.execute 在本部署的 ptc 模式下必然被折叠。
      const ctx = {
        tools: {
          get: () => ({
            execute: async (args: { query: string }) => {
              seen.push(args.query);
              return {
                content: [
                  {
                    type: 'text',
                    text:
                      args.query === '记忆'
                        ? JSON.stringify({ items: [{ id: 'm9', kind: 'fact', content: '跨设备共享记忆统一走 Cairn' }] })
                        : '{"items":[]}',
                  },
                ],
              };
            },
          }),
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

    it('定义上没有 execute 时退回 tools.execute（跨部署兜底）', async () => {
      const viaService: string[] = [];
      const ctx = {
        tools: {
          get: () => ({}),
          execute: async (input: { arguments: { query: string } }) => {
            viaService.push(input.arguments.query);
            return {
              isError: false,
              value: {},
              content: [
                {
                  type: 'text',
                  text:
                    input.arguments.query === '记忆'
                      ? JSON.stringify({ items: [{ id: 'm10', kind: 'fact', content: '记忆跨设备统一走 Cairn' }] })
                      : '{"items":[]}',
                },
              ],
            };
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
      assert.ok(viaService.includes('记忆'), '定义体不可用时必须退回 tools.execute');
      assert.equal(injected.length, 1, '兜底路径也必须注入');
    });

    it('成功召回会清掉上一次的调用错误（旧错误不许长期污染诊断）', async () => {
      let failing = true;
      const ctx = {
        tools: {
          get: () => ({
            execute: async () => {
              if (failing) throw new Error('boom');
              return {
                content: [
                  { type: 'text', text: JSON.stringify({ items: [{ id: 'm11', kind: 'fact', content: '投影预算是 2KB' }] }) },
                ],
              };
            },
          }),
        },
        on: (e: string, fn: unknown) => { (ctx as Record<string, unknown>)[e] = fn; },
      };
      apply(ctx, {});
      const preStep = (ctx as Record<string, unknown>)['agent/pre-step'] as
        (p: unknown, n?: () => unknown) => Promise<unknown>;
      const step = {
        agent: { inject: () => {} },
        messages: [{ role: 'user', content: [{ type: 'text', text: '投影预算是多少' }] }],
      };
      await preStep(step, () => {});
      assert.equal(recallDiag.lastError, 'boom', '失败必须留痕');
      failing = false;
      await preStep(step, () => {});
      assert.equal(recallDiag.lastError, undefined, '成功后必须清掉旧错误');
    });
  });
});

describe('会话隔离（2026-11-02 用户实测：面板把多个会话叠加显示）', () => {
  const step = (id: string, inject: (m: unknown) => void) => ({
    agent: { id, inject },
    messages: [{ role: 'user', content: [{ type: 'text', text: '投影预算是多少' }] }],
  });

  it('A 会话注入过的记忆，B 会话仍会注入；端点按 ?session= 切片', async () => {
    const { ctx, readUsage } = makeSpyCtx();
    apply(ctx, {});
    const preStep = (ctx as Record<string, unknown>)['agent/pre-step'] as
      (p: unknown, n?: () => unknown) => Promise<unknown>;

    const a: unknown[] = [];
    const b: unknown[] = [];
    await preStep(step('sess-A', (m) => a.push(m)), () => {});
    await preStep(step('sess-B', (m) => b.push(m)), () => {});

    assert.equal(a.length, 1, 'A 应注入');
    assert.equal(b.length, 1, 'B 不能被 A 的去重挡掉——去重集合必须是会话级的');

    const ua = readUsage('/plugins/cairn-dsh-memory/usage?session=sess-A&history=1') as Record<string, unknown>;
    const ub = readUsage('/plugins/cairn-dsh-memory/usage?session=sess-B&history=1') as Record<string, unknown>;
    assert.equal(ua['session'], 'sess-A');
    assert.equal((ua['recent'] as unknown[]).length, 1, 'A 只能看到自己的记录');
    assert.equal((ub['recent'] as unknown[]).length, 1, 'B 只能看到自己的记录');
    assert.equal(((ua['sessionInjected'] as { id: string }[])[0] ?? {}).id, 'm1', '本会话累计注入要带上');
    assert.equal(((ua['recent'] as { items?: { id: string }[] }[])[0]?.items ?? [])[0]?.id, 'm1', '记录要带 items 供点选高亮');
  });

  it('同会话第二步因去重跳过，累计集合不重复增长；无 session 参数回落最近活跃会话', async () => {
    const { ctx, readUsage } = makeSpyCtx();
    apply(ctx, {});
    const preStep = (ctx as Record<string, unknown>)['agent/pre-step'] as
      (p: unknown, n?: () => unknown) => Promise<unknown>;

    await preStep(step('sess-A', () => {}), () => {});
    await preStep(step('sess-A', () => {}), () => {});
    const ua = readUsage('/plugins/cairn-dsh-memory/usage?session=sess-A&history=1') as Record<string, unknown>;
    assert.equal((ua['recent'] as unknown[]).length, 2, '两步都要留痕');
    assert.equal((ua['sessionInjected'] as unknown[]).length, 1, '同一 id 在会话累计里只出现一次');

    await preStep(step('sess-B', () => {}), () => {});
    const any = readUsage('/plugins/cairn-dsh-memory/usage?history=1') as Record<string, unknown>;
    assert.equal(any['session'], 'sess-B', '不带 session 时取最近活跃的那个（curl 自检可用）');
  });
});

describe('活动持久化开关（默认内存，用户 2026-11-02 决策）', () => {
  const PREV_HOME = process.env.CAIRN_HOME;
  const PREV_MAX = process.env.CAIRN_ACTIVITY_MAX_BYTES;
  let home = '';

  function useTempHome(): string {
    home = mkdtempSync(join(tmpdir(), 'cairn-dsh-persist-'));
    process.env.CAIRN_HOME = home;
    return home;
  }
  function postPersist(handler: (req: unknown, res: unknown) => void, enabled: unknown): { status?: number; body: string } {
    const out: { status?: number; body: string } = { body: '' };
    handler(
      {
        method: 'POST',
        on: (ev: string, cb: (c?: unknown) => void) => {
          if (ev === 'data') cb(typeof enabled === 'string' ? enabled : JSON.stringify({ enabled }));
          if (ev === 'end') cb();
        },
      },
      { writeHead: (s: number) => { out.status = s; }, end: (b: string) => { out.body = b; } },
    );
    return out;
  }

  afterEach(() => {
    if (PREV_HOME === undefined) delete process.env.CAIRN_HOME; else process.env.CAIRN_HOME = PREV_HOME;
    if (PREV_MAX === undefined) delete process.env.CAIRN_ACTIVITY_MAX_BYTES; else process.env.CAIRN_ACTIVITY_MAX_BYTES = PREV_MAX;
    if (home) { try { rmSync(home, { recursive: true, force: true }); } catch { /* 临时目录删不掉就算了 */ } home = ''; }
  });

  it('默认内存：不落盘，payload.persist=false', async () => {
    useTempHome();
    const { ctx, readUsage } = makeSpyCtx();
    apply(ctx, {});
    const preStep = (ctx as Record<string, unknown>)['agent/pre-step'] as (p: unknown, n?: () => unknown) => Promise<unknown>;
    await preStep({ agent: { inject: () => {} }, messages: [{ role: 'user', content: [{ type: 'text', text: '投影预算是多少' }] }] }, () => {});
    assert.equal(existsSync(join(home, ACTIVITY_FILE)), false, '默认不创建日志文件');
    assert.equal(readUsage().persist, false);
  });

  it('切换落盘：marker 写入、条目追加、查询原文与正文零出现', async () => {
    useTempHome();
    const { ctx, readUsage, handlerFor } = makeSpyCtx();
    apply(ctx, {});
    const resp = postPersist(handlerFor('/plugins/cairn-dsh-memory/persist'), true);
    assert.equal(resp.status, 200);
    assert.equal((JSON.parse(resp.body) as { enabled: boolean }).enabled, true);
    assert.ok(existsSync(join(home, 'activity-dsh.enabled')), 'marker 必须写入');
    const preStep = (ctx as Record<string, unknown>)['agent/pre-step'] as (p: unknown, n?: () => unknown) => Promise<unknown>;
    await preStep({ agent: { inject: () => {} }, messages: [{ role: 'user', content: [{ type: 'text', text: '投影预算是多少' }] }] }, () => {});
    const file = join(home, ACTIVITY_FILE);
    assert.ok(existsSync(file), '落盘后必须有日志文件');
    const content = readFileSync(file, 'utf8');
    assert.match(content, /自动召回/, '条目是摘要');
    assert.ok(!content.includes('投影预算是多少'), '查询原文绝不入文件');
    assert.ok(!content.includes('投影预算是 2KB'), '记忆正文绝不入文件');
    assert.equal(readUsage().persist, true);
  });

  it('重启回放：新实例从文件恢复尾部且不重复', async () => {
    useTempHome();
    const a = makeSpyCtx();
    apply(a.ctx, {});
    postPersist(a.handlerFor('/plugins/cairn-dsh-memory/persist'), true);
    const preStepA = (a.ctx as Record<string, unknown>)['agent/pre-step'] as (p: unknown, n?: () => unknown) => Promise<unknown>;
    await preStepA({ agent: { inject: () => {} }, messages: [{ role: 'user', content: [{ type: 'text', text: '第一次' }] }] }, () => {});
    const onPostA = (a.ctx as Record<string, unknown>)['tools/post-execute'] as (e: unknown, r: unknown, n?: () => unknown) => Promise<unknown>;
    await onPostA({ name: 'mcp__cairn__memory_search' }, {}, () => {});
    const file = join(home, ACTIVITY_FILE);
    const before = readFileSync(file, 'utf8').trim().split('\n').length;

    // 模拟重启：全新 apply 实例，同一 CAIRN_HOME
    const b = makeSpyCtx();
    apply(b.ctx, {});
    const recent = (b.readUsage().recent as { t: string; summary: string }[]) ?? [];
    assert.equal(recent.length, before, '重启后恢复相同条数');
    const unique = new Set(recent.map((e) => e.t + '|' + e.summary));
    assert.equal(unique.size, recent.length, '回放不得产生重复条目');
  });

  it('切回内存：marker 删除、停止追加', async () => {
    useTempHome();
    const { ctx, readUsage, handlerFor } = makeSpyCtx();
    apply(ctx, {});
    const persistHandler = handlerFor('/plugins/cairn-dsh-memory/persist');
    postPersist(persistHandler, true);
    const file = join(home, ACTIVITY_FILE);
    const preStep = (ctx as Record<string, unknown>)['agent/pre-step'] as (p: unknown, n?: () => unknown) => Promise<unknown>;
    await preStep({ agent: { inject: () => {} }, messages: [{ role: 'user', content: '第一条' }] }, () => {});
    const sizeOn = statSync(file).size;
    const resp = postPersist(persistHandler, false);
    assert.equal((JSON.parse(resp.body) as { enabled: boolean }).enabled, false);
    assert.equal(existsSync(join(home, 'activity-dsh.enabled')), false, 'marker 必须删除');
    await preStep({ agent: { inject: () => {} }, messages: [{ role: 'user', content: '第二条' }] }, () => {});
    assert.equal(statSync(file).size, sizeOn, '关闭后不再追加');
    assert.equal(readUsage().persist, false);
  });

  it('轮转：超过阈值滚动 .old，日志文件重新从零开始', async () => {
    useTempHome();
    process.env.CAIRN_ACTIVITY_MAX_BYTES = '200';
    const { ctx, handlerFor } = makeSpyCtx();
    apply(ctx, {});
    postPersist(handlerFor('/plugins/cairn-dsh-memory/persist'), true);
    const preStep = (ctx as Record<string, unknown>)['agent/pre-step'] as (p: unknown, n?: () => unknown) => Promise<unknown>;
    for (let i = 0; i < 12; i++) {
      await preStep({ agent: { inject: () => {} }, messages: [{ role: 'user', content: `第${i}轮轮转测试消息` }] }, () => {});
    }
    assert.ok(existsSync(join(home, ACTIVITY_FILE + '.old')), '必须滚动出 .old');
    assert.ok(statSync(join(home, ACTIVITY_FILE)).size < 400, '当前文件回到小体量');
  });

  it('非法 body 返回 400，不翻转状态', () => {
    useTempHome();
    const { ctx, handlerFor } = makeSpyCtx();
    apply(ctx, {});
    const persistHandler = handlerFor('/plugins/cairn-dsh-memory/persist');
    const bad1 = postPersist(persistHandler, '{"enabled":"yes"}');
    assert.equal(bad1.status, 400);
    const bad2 = postPersist(persistHandler, 'not-json');
    assert.equal(bad2.status, 400);
    assert.equal(existsSync(join(home, 'activity-dsh.enabled')), false, '非法请求不得开落盘');
  });
});
describe('状态判定：有候选且已渲染时不能是 miss（2026-11-02 实测缺陷）', () => {
  it('frontmatter 记忆的 summary 能被 includes 匹配，status=injected', () => {
    const content = '---\nname: 交付先归档\ndescription: 说明\n---\n正文';
    const summary = toSummary(content);
    assert.equal(summary, '交付先归档');
    // 旧实现用 content 首行前 20 字（'---'）去 includes，永远不匹配 → miss
    assert.ok(!content.split(/\r?\n/)[0]!.trim().slice(0, 20).includes('交付先归档'));
  });
});

describe('注入消息必须带 id（否则写坏 session log）', () => {
  // 2026-11-02 实测：宿主 assertMessageEventShape 要求 user/message 的 data 自身
  // 带非空字符串 id，缺失即抛 `lacks an identified message`，整段会话被判 corrupt
  // 且无法再加载。三条注入把 session-1d2ddcb3 写坏就是这个原因。
  it('makeInjectionMessage 产出可直接落盘的完整消息形状', () => {
    const m = makeInjectionMessage('注入文本');
    assert.equal(typeof m.id, 'string');
    assert.ok(m.id.length > 0, 'id 不得为空字符串');
    assert.equal(m.role, 'user');
    assert.ok(Array.isArray(m.content));
    assert.equal(m.content[0]!.type, 'text');
    assert.equal(m.content[0]!.text, '注入文本');
    assert.equal(m.source.kind, 'cairn-memory-injection');
  });

  it('每次调用 id 唯一，重放不撞 id', () => {
    const ids = new Set(Array.from({ length: 50 }, () => makeInjectionMessage('x').id));
    assert.equal(ids.size, 50);
  });
});

describe('路由注册必须由 owner.effect 托管（HMR 重载不再撞重复路由）', () => {
  // 2026-11-02 实测：webServer.register() 返回 disposer，裸调用丢弃它 → 插件被 HMR
  // 重载时旧路由不释放，新实例抛 `webserver: duplicate exact route`，整条 fiber 失败，
  // /usage 一直由旧闭包响应（返回重载前的陈旧数据）。
  it('提供 effect 时，两条路由都通过 effect 注册', () => {
    const registered: unknown[] = [];
    const effects: string[] = [];
    const ctx = {
      webServer: { register: (o: unknown) => { registered.push(o); return () => {}; } },
      effect: (fn: () => unknown, label?: string) => { effects.push(label ?? ''); return fn(); },
      on: () => {},
    };
    apply(ctx, {});
    assert.equal(effects.length, 2, 'usage 与 persist 各一条 effect');
    assert.ok(effects.some((l) => l.includes('/plugins/cairn-dsh-memory/usage')), effects.join('|'));
    assert.ok(effects.some((l) => l.includes('/plugins/cairn-dsh-memory/persist')), effects.join('|'));
    assert.equal(registered.length, 2);
  });

  it('没有 effect（降级）时仍然注册成功', () => {
    const registered: unknown[] = [];
    apply({
      webServer: { register: (o: unknown) => { registered.push(o); return () => {}; } },
      on: () => {},
    }, {});
    assert.equal(registered.length, 2, '降级路径不能把面板搞没');
  });
});
describe('去重早退不得覆盖 lastUsage（2026-11-02 面板误报 miss 的真因）', () => {
  it('第一步注入后，第二步因去重早退，lastUsage 必须保留第一步的结果', async () => {
    let call = 0;
    const routes: { path?: string; handler?: Function }[] = [];
    const ctx: Record<string, unknown> = {
      tools: {
        get: () => ({
          execute: async () => {
            call += 1;
            return { content: [{ text: JSON.stringify({ items: [{ id: 'm1', kind: 'fact', content: '投影预算是 2KB' }] }) }] };
          },
        }),
      },
      webServer: { register: (o: unknown) => routes.push(o as never) },
      on: (e: string, fn: unknown) => { ctx[e] = fn; },
    };
    apply(ctx, {});

    const preStep = ctx['agent/pre-step'] as (p: unknown, n?: () => unknown) => Promise<unknown>;
    const call1 = { agent: { inject: () => {} }, messages: [{ role: 'user', content: [{ type: 'text', text: '投影预算是多少' }] }] };
    await preStep(call1, () => {});

    const usageHandler = (routes.find((r) => String(r.path).endsWith('/usage')) as { handler: Function }).handler;
    const read = () => {
      let body = '';
      usageHandler({ method: 'GET', url: '/' }, { writeHead: () => {}, end: (s: string) => { body = s; } });
      return JSON.parse(body) as Record<string, unknown>;
    };

    const after1 = read();
    assert.equal(after1['status'], 'injected', '第一步应记录 injected');
    assert.ok(Number(after1['candidates']) > 0);

    // 第二步：同一条记忆被去重，fresh 为空 → 早退
    await preStep(call1, () => {});
    const after2 = read();
    assert.equal(after2['status'], 'injected', '早退不得把状态改回 miss');
    assert.equal(after2['candidates'], after1['candidates'], '早退不得清空 candidates');
    assert.ok(Number(call) >= 2, '两次都应发起召回');
  });
});
