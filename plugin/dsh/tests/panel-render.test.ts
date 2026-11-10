/**
 * 记忆面板的**渲染结构冒烟**（不测像素，只测「渲染不炸 + 结构对」）。
 *
 * 为什么需要它：宿主 slot 有 crash boundary，组件一抛错整个 tab 变成空白，
 * 而空白在端点上看起来跟「没数据」一模一样（Round-10 就这么被误判过一轮）。
 * 单测覆盖不到 client.js，所以这里用 stub React 把组件树跑一遍。
 *
 * 不覆盖：真实布局（flex/滚动）、颜色对比度、宿主 slot 契约——那些只能人工看。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

type Node_ = { type: unknown; props: Record<string, unknown>; children: unknown[] };

function renderPanel(
  data: Record<string, unknown>,
  filters: Record<string, unknown> = {},
  stored: { filters?: string | null; layout?: string | null } = {},
) {
  // load() 收到的是**定义对象** { id, factory }，不是工厂函数本身。
  const captured: { def?: { factory: (req: (n: string) => unknown) => { apply: (c: unknown) => void } } } = {};
  const g = globalThis as Record<string, unknown>;
  const w = {
    __ModuleLoader__: { load: (d: unknown) => { captured.def = d as never; } },
    localStorage: {
      getItem: (k: string) =>
        k === 'cairn-memory-tab-layout' ? (stored.layout ?? null)
          : k === 'cairn-memory-tab-filters' ? (stored.filters ?? null)
          : null,
      setItem: () => {},
      removeItem: () => {},
    },
    getComputedStyle: () => ({ backgroundColor: 'rgba(0,0,0,0)' }),
    matchMedia: () => ({ matches: true }),
  };
  g.window = w;
  g.document = { body: {}, documentElement: {} };
  try {
    const src = readFileSync(join(import.meta.dirname ?? __dirname, '..', 'src', 'client.js'), 'utf8');
    // client.js 是浏览器侧脚本：靠 window.__ModuleLoader__ 自注册，这里用 Function 喂一个假 window。
    new Function('window', src)(w);
    // 迷你 hook store：按顺序给每个 useState 分格，setState 改格子并支持重渲染。
    // 前四格预置（data / failed / filters / persist），其余走惰性初始化——
    // leftPct 就是这样读到 localStorage 里的布局的。
    const store: unknown[] = [
      data,
      false,
      { recall: true, tool: true, limit: 30, detail: 'full', text: 'auto', ...filters },
      false,
    ];
    let hookIndex = 0;
    const el = (type: unknown, props: unknown, ...children: unknown[]): Node_ => ({
      type,
      props: (props as Record<string, unknown>) ?? {},
      children: children.flat(9),
    });
    const React = {
      createElement: el,
      useState(init: unknown) {
        const i = hookIndex++;
        if (!(i in store)) store[i] = typeof init === 'function' ? (init as () => unknown)() : init;
        return [store[i], (v: unknown) => { store[i] = typeof v === 'function' ? (v as (x: unknown) => unknown)(store[i]) : v; }];
      },
      useEffect: () => {},
      useRef: (init: unknown) => ({ current: init }),
    };
    const mod = captured.def!.factory((n: string) => {
      if (n === 'react') return React;
      throw new Error('unexpected require: ' + n);
    });
    let Comp: (() => Node_) | undefined;
    mod.apply({ slots: { inject: (_n: string, cb: () => void) => cb(), register: (_o: unknown, c: () => Node_) => { Comp = c; return () => {}; } } });
    assert.ok(Comp, '组件必须注册到 conversation.view');
    const component = Comp!;
    const render = () => { hookIndex = 0; return component(); };
    return { tree: render(), render };
  } finally {
    delete g.window;
    delete g.document;
  }
}

function collect(node: unknown, out: { texts: string[]; buttons: number; nodes: Node_[] } = { texts: [], buttons: 0, nodes: [] }) {
  if (node == null) return out;
  if (Array.isArray(node)) { node.forEach((n) => collect(n, out)); return out; }
  if (typeof node === 'string' || typeof node === 'number') { out.texts.push(String(node)); return out; }
  if (typeof node !== 'object') return out;
  const n = node as Node_;
  out.nodes.push(n);
  if (n.type === 'button') out.buttons += 1;
  for (const [k, v] of Object.entries(n.props)) {
    if (k !== 'children' && typeof v === 'string') out.texts.push(v);
  }
  n.children.forEach((c) => collect(c, out));
  return out;
}

const BASE = {
  status: 'injected',
  label: '已注入',
  candidates: 5,
  injected: [{ id: 'm1', kind: 'fact', summary: '投影预算是 2KB' }],
  // 本会话累计注入（去重）：count 是注入次数。
  sessionInjected: [{ id: 'm1', kind: 'fact', summary: '投影预算是 2KB' }],
  matchedBy: 'fts',
  bytesUsed: 190,
  bytesBudget: 1536,
  filteredCount: 0,
  recent: [{
    t: '2026-11-02T04:36:09.916Z',
    kind: 'recall',
    summary: '自动召回 候选5 注入1',
    items: [{ id: 'm1', kind: 'fact', summary: '投影预算是 2KB' }],
  }],
  persist: false,
};

describe('记忆面板渲染结构（左右两栏，2026-11-02）', () => {
  it('渲染不抛错，且根节点仍带状态属性与两栏容器', () => {
    const { tree } = renderPanel(BASE);
    assert.equal(tree.props['data-cairn-usage'], 'injected', 'e2e/端点探针依赖这个属性');
    assert.equal((tree.props.style as Record<string, unknown>).flexWrap, 'wrap', '两栏要靠 flex-wrap 自适应堆叠');
    assert.equal(tree.children.length, 3, '根节点＝左栏 + 拖拽手柄 + 右栏');
    assert.equal(tree.children[1].props['data-cairn-split'], '1', '中间必须是拖拽手柄');
  });

  it('左上＝状态与指标，左下＝本会话注入', () => {
    const { texts } = collect(renderPanel(BASE).tree);
    const all = texts.join('\n');
    assert.ok(all.includes('已注入'), '状态文字必须在（不能只靠颜色）');
    assert.ok(all.includes('召回条数') && all.includes('预算占用'), '四项指标保留');
    assert.ok(all.includes('本会话注入的记忆') && all.includes('投影预算是 2KB'), '左下要列出本会话注入过的条目');
  });

  it('右侧＝活动记录，且没有「条目数量」按钮', () => {
    const { texts, nodes } = collect(renderPanel(BASE).tree);
    const all = texts.join('\n');
    assert.ok(all.includes('活动记录') && all.includes('自动召回'), '活动记录在右侧');
    // 左侧口径行会带「N 条」，所以只对**按钮文字**做限制。
    const buttonLabels = nodes.filter((n) => n.type === 'button').map((n) => collect(n).texts.join(''));
    assert.ok(!buttonLabels.some((l) => /\d+\s*条/.test(l)), '不得再出现「15条/30条/120条」按钮');
    assert.equal(buttonLabels.length, 10, '筛选/开关 2+2+3+2 再加一个「重置布局」');
    assert.ok(all.includes('重置布局'), '必须有恢复默认布局的入口');
  });

  it('左栏口径行：累计条数 + 「右栏记录每一步，本栏按去重累计」', () => {
    const all = collect(renderPanel(BASE).tree).texts.join('\n');
    assert.ok(all.includes('1 条 · 右栏记录每一步，本栏按去重累计'), '左栏必须解释两栏口径不同');
  });

  it('折叠记录显示次数与最近时间，title 给出首末时间', () => {
    const folded = {
      ...BASE,
      recent: [{
        t: '2026-11-02T04:40:00.000Z',
        firstT: '2026-11-02T04:30:00.000Z',
        kind: 'recall',
        count: 20,
        summary: '自动召回 已去重 1 条（本会话已注入 1 条）',
      }],
    };
    const { texts, nodes } = collect(renderPanel(folded).tree);
    const hhmmss = (iso: string) => new Date(iso).toTimeString().slice(0, 8);
    assert.ok(texts.join('\n').includes('20 次'), '折叠条目必须显示发生次数');
    assert.ok(texts.join('\n').includes(hhmmss('2026-11-02T04:40:00.000Z')), '时间列显示最近一次');
    const timed = nodes.find((n) => typeof n.props.title === 'string' && n.props.title.includes('首次 ' + hhmmss('2026-11-02T04:30:00.000Z')) && n.props.title.includes('20 次'));
    assert.ok(timed, 'title 必须能看出时间跨度');
  });

  it('旧 nothing_new 记录按「已去重」展示，不出现「注入0」', () => {
    const legacy = {
      ...BASE,
      recent: [{ t: '2026-11-02T04:36:09.916Z', kind: 'recall', summary: '自动召回 候选5 注入0 (nothing_new)' }],
    };
    const all = collect(renderPanel(legacy).tree).texts.join('\n');
    assert.ok(!all.includes('注入0'), '旧记录也不许把「已去重」读成「注入0」');
    assert.ok(all.includes('已去重'), '旧 nothing_new 行按「已去重」一类展示');
  });

  it('栏宽：没拖过用自适应基准，拖过用固定占比，越界值忽略', () => {
    const auto = renderPanel(BASE).tree.children[0].props.style as Record<string, unknown>;
    assert.equal(auto.flex, '1 1 320px', '默认交给 flex 自适应（窄了会堆叠）');

    const fixed = renderPanel(BASE, {}, { layout: JSON.stringify({ leftPct: 62 }) }).tree.children[0].props.style as Record<string, unknown>;
    assert.equal(fixed.flex, '0 0 62%', '存过布局就按占比');

    const bad = renderPanel(BASE, {}, { layout: JSON.stringify({ leftPct: 99 }) }).tree.children[0].props.style as Record<string, unknown>;
    assert.equal(bad.flex, '1 1 320px', '越界/脏数据必须回落到默认，不能让左栏吃掉整屏');
  });

  it('本会话累计注入：左下是去重后的会话集合，不是本轮候选', () => {
    const { texts } = collect(renderPanel(BASE).tree);
    const all = texts.join('\n');
    assert.ok(all.includes('本会话注入的记忆'), '左下的口径是「本会话」而不是「本轮」');
    assert.equal(all.split('投影预算是 2KB').length - 1, 1, '同一 id 只出现一次（去重）');
  });

  it('点选右侧记录 → 左侧对应记忆高亮，再点一次取消', () => {
    const { tree, render } = renderPanel(BASE);
    const all = collect(tree).nodes;
    const row = all.find((n) => n.props.role === 'button' && typeof n.props.onClick === 'function');
    assert.ok(row, '带 items 的召回记录必须可点选');

    (row!.props.onClick as () => void)();
    const after = collect(render()).nodes;
    const hit = after.find((n) => n.props['data-cairn-hit'] === '1');
    assert.ok(hit, '选中后左侧条目必须带高亮标记');
    assert.ok(after.some((n) => n.props.role === 'button' && n.props.onClick && collect(n).texts.join('').includes('◉')), '选中行自己也要有标记');

    const again = collect(render()).nodes.find((n) => n.props.role === 'button' && typeof n.props.onClick === 'function');
    (again!.props.onClick as () => void)();
    const cleared = collect(render()).nodes;
    assert.ok(!cleared.some((n) => n.props['data-cairn-hit'] === '1'), '再点一次必须取消高亮');
  });

  it('没有注入时左下方给占位文案，不是空白', () => {
    const { texts } = collect(renderPanel({ ...BASE, status: 'miss', label: '未命中', injected: [], sessionInjected: [] }).tree);
    assert.ok(texts.join('\n').includes('本会话还没有注入过记忆'), '空态必须有文案');
  });
});
