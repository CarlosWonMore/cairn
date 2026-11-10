import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UI_CSS } from '../../src/interfaces/console/assets/ui-css.js';
import { UI_JS } from '../../src/interfaces/console/assets/ui-js.js';
import { URL_STATE_SRC } from '../../src/interfaces/console/assets/url-state.js';
import { renderShell } from '../../src/interfaces/console/assets/page.js';

/**
 * 前端静态资源的"可审计性质"（任务 4.1 / 4.7）。
 *
 * 这些断言不看像素，只看那些**一旦退化就会静默变坏**的性质：
 * 语义色是否齐全、有没有引入外部资源、脚本能不能被解析、
 * 快捷键表是否还在、以及是否存在 innerHTML 这类 XSS 入口。
 */

const SEMANTIC_TOKENS = ['--layer', '--warn', '--ok', '--pending', '--danger', '--busy', '--muted'];

test('CSS：7 类语义色在暗色与亮色主题下都有定义', () => {
  for (const t of SEMANTIC_TOKENS) {
    const hits = UI_CSS.split(`${t}:`).length - 1;
    assert.ok(hits >= 2, `${t} 应至少在 :root 与亮色覆盖中各定义一次，实际 ${hits} 次`);
  }
});

test('CSS：零外部资源（离线硬要求）', () => {
  assert.equal(/@import/i.test(UI_CSS), false, 'CSS 不得 @import');
  assert.equal(/url\(\s*['"]?https?:/i.test(UI_CSS), false, 'CSS 不得引用远程资源');
  assert.equal(/https?:\/\//i.test(UI_CSS), false, 'CSS 内不得出现任何绝对 URL');
  assert.equal(/@font-face/i.test(UI_CSS), false, '不内嵌 Web Font，只用系统字体栈');
  assert.ok(UI_CSS.includes('ui-sans-serif'), '字体必须是系统栈');
});

test('CSS：降级媒体查询与焦点可见性', () => {
  assert.ok(/@media \(prefers-reduced-motion: reduce\)/.test(UI_CSS), '必须有动效降级媒体查询');
  assert.ok(/@media \(max-width: 720px\)/.test(UI_CSS), '窄屏断点必须存在');
  assert.ok(/:focus-visible/.test(UI_CSS), '键盘焦点必须有可见轮廓');
});

test('UI_JS：可被 JS 引擎解析（语法退化会在浏览器里静默白屏）', () => {
  assert.doesNotThrow(() => new Function(UI_JS));
  assert.ok(UI_JS.includes("'use strict'"));
});

test('UI_JS：URL 状态编解码只有一份实现（页面嵌入即测试对象）', () => {
  assert.ok(UI_JS.includes(URL_STATE_SRC), '页面脚本必须原样嵌入 url-state 源码');
  assert.ok(UI_JS.includes('function encodeState'));
  assert.ok(UI_JS.includes('function decodeState'));
  // 反向断言：旧的复制版实现不得残留
  assert.equal(UI_JS.includes("p.set('view', state.view)"), false, '不得保留第二份写 URL 的实现');
});

test('UI_JS：不使用 innerHTML（所有正文走 textContent）', () => {
  assert.equal(/\.innerHTML\s*=/.test(UI_JS), false, 'innerHTML 是记忆正文的 XSS 入口，必须为零');
  assert.equal(/outerHTML\s*=/.test(UI_JS), false);
  assert.equal(/document\.write/.test(UI_JS), false);
  assert.ok(UI_JS.includes('textContent'), '应通过 textContent 写入文本');
});

test('UI_JS：所有请求都打到同源 /api/*', () => {
  const paths = [...UI_JS.matchAll(/api\(\s*'([^']+)'/g)].map((m) => m[1]!);
  assert.ok(paths.length >= 10, `应能识别出全部 API 调用，实际 ${paths.length}`);
  for (const p of paths) assert.ok(p.startsWith('/api/'), `${p} 必须同源 /api 前缀`);
  assert.equal(/https?:\/\/(?!127\.0\.0\.1)/.test(UI_JS), false, '前端不得硬编码远程地址');
});

test('UI_JS：快捷键表完整（1-7 / / P T M ? Esc）', () => {
  for (const key of ["ev.key >= '1'", "ev.key <= '7'", "ev.key === '/'", "ev.key === 'p'", "ev.key === 't'", "ev.key === 'm'", "ev.key === '?'", "'Escape'"]) {
    assert.ok(UI_JS.includes(key), `缺少快捷键绑定：${key}`);
  }
  assert.ok(UI_JS.includes('INPUT') && UI_JS.includes('TEXTAREA'), '输入框内不得劫持按键');
  assert.ok(UI_JS.includes('ev.metaKey || ev.ctrlKey || ev.altKey'), '带修饰键的组合必须放行');
});

test('UI_JS：摘要/全文切换会同步地址与本地偏好', () => {
  assert.ok(UI_JS.includes('function toggleMode'));
  assert.ok(UI_JS.includes('localStorage.setItem(MODE_KEY'), '模式选择要记住');
  assert.ok(UI_JS.includes('writeUrl('), '切换后地址要同步');
  assert.ok(UI_JS.includes('\'data-action\': \'mode\''), '控件与快捷键必须共用 toggleMode 这一个入口');
});

test('UI_JS：静态预览同样可切换视图，但不动地址栏', () => {
  // 浏览是只读动作：静态页把导航关掉会让"预览页也能看导入与条目"落空
  assert.equal(/if \(STATIC\) \{ nav\.style\.display/.test(UI_JS), false, '导航不得在静态模式下被隐藏');
  assert.ok(UI_JS.includes('data-view'), '导航项应带可识别标识');
  assert.ok(/function writeUrl\(push\) \{[\s\S]{0,200}if \(STATIC\) return;/.test(UI_JS), 'file:// 下不得改地址栏');
  assert.ok(UI_JS.includes('静态导出不含同步能力'), '同步视图在静态下的降级说明必须存在');
  assert.ok(UI_JS.includes('静态导出是只读快照'), '导入视图在静态下的降级说明必须存在');
});

test('renderShell：静态模式带内联模型，HTTP 模式不带', () => {
  const live = renderShell({ title: 't', subtitle: 's' });
  assert.ok(live.includes('<!DOCTYPE html>'));
  assert.equal(live.includes('data-static="1"'), false);
  assert.equal(live.includes('id="cairn-model"'), false);

  const stat = renderShell({ title: 't', subtitle: 's', modelJson: '{"a":1}' });
  assert.ok(stat.includes('data-static="1"'));
  assert.ok(stat.includes('id="cairn-model"'));
  assert.ok(stat.includes('{"a":1}'));
});

test('renderShell：警示横幅按顺序渲染且经过转义', () => {
  const html = renderShell({ title: 't', subtitle: 's', banners: ['<b>x</b>', '第二行'] });
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'), '横幅文本必须转义');
  assert.equal(html.includes('<b>x</b>'), false);
  assert.ok(html.indexOf('第二行') > html.indexOf('x&lt;/b&gt;'), '横幅保持传入顺序');
});

test('UI_JS：抽屉三入口共用同一段关闭逻辑，且把焦点还给打开者', () => {
  // 一个自制 DOM 面板最容易漏的是"Esc 关了但焦点丢了"：键盘用户关掉抽屉后
  // 落回 body，等于每次都要重新 Tab 一遍。这里把四个入口都钉住。
  assert.ok(UI_JS.includes("role: 'dialog'"), '抽屉必须是 dialog 语义');
  assert.ok(UI_JS.includes("'aria-modal': 'true'"), '模态要声明，读屏才知道外面不可交互');
  assert.ok(UI_JS.includes("ev.key === 'Escape'"), 'Esc 必须能关');
  assert.ok(/if \(ev\.target === mask\) close\(\)/.test(UI_JS), '点遮罩要能关，点面板内部不能关');
  assert.ok(UI_JS.includes('x.addEventListener(\'click\', close)'), '关闭按钮与 Esc 必须是同一个 close');
  assert.ok(UI_JS.includes('prev.focus()'), '关闭后必须把焦点还给打开抽屉的那个元素');
  assert.ok(UI_JS.includes('document.removeEventListener(\'keydown\', onKey)'), '关闭要摘掉键盘监听，否则会叠加');
  assert.ok(UI_JS.includes('drawerCloser'), '重复打开必须先关掉上一个，避免叠两层遮罩');
});

test('UI_JS：抽屉状态进地址，刷新可还原', () => {
  assert.ok(UI_JS.includes('state.drawer'), '地址要能带 drawer');
  assert.ok(UI_JS.includes('state.item'), '地址要能带 item');
  assert.ok(/state\.drawer = r\.id;[\s\S]{0,120}writeUrl\(false\)/.test(UI_JS), '打开抽屉后要写回地址');
});

test('UI_JS：同源重复导入折进 details，默认只展开最新一次', () => {
  assert.ok(UI_JS.includes('历史导入 '), '折叠标题要说清是历史导入');
  assert.ok(UI_JS.includes("el('details')"), '折叠要用 details，不另造展开状态');
  assert.ok(UI_JS.includes('isLatestOfSource'), '哪次是最新由后端算，前端不自己猜');
});

// ---------------------------------------------------------------------------
// 浏览器点击级验收兜住的三个缺陷（2026-10-30，见 scripts/e2e-console-ui.mjs）
//
// 这三条都是"源码看着对、真点下去不对"的类型，纯 DOM 断言测不出来，
// 但它们的**代码形状**可以钉住，避免以后重构时又退化。
// ---------------------------------------------------------------------------

test('UI_JS：摘掉令牌参数时不能连状态参数一起清掉', () => {
  // 曾经的写法是 history.replaceState(null, '', location.pathname) —— 把 view/q/drawer
  // 全抹了，分享出去的链接打开永远回到概览，抽屉也打不开。只允许删 t 这一个键。
  assert.ok(UI_JS.includes("keep.delete('t')"), '只摘令牌参数本身');
  assert.equal(
    /history\.replaceState\(null, '', location\.pathname\)/.test(UI_JS),
    false,
    '不得用 location.pathname 整体覆盖（会丢掉 view/drawer 等状态）',
  );
  assert.ok(/keep\.toString\(\)/.test(UI_JS), '剩余参数要原样写回地址');
});

test('UI_JS：切视图先收抽屉，否则遮罩盖住导航点不动', () => {
  // 实测症状：抽屉里"确认生成计划"跳审批后，抽屉留在原地挡住了整个导航栏。
  assert.ok(
    /function go\(view, push\) \{[\s\S]{0,260}closeDrawer\(\)/.test(UI_JS),
    'go() 必须在切视图时关掉抽屉',
  );
  assert.ok(
    /if \(view !== state\.view\) \{[\s\S]{0,120}state\.drawer = ''/.test(UI_JS),
    '抽屉状态属于原视图，切视图要清掉，不能带进新视图的地址',
  );
});

test('UI_JS：策略下拉记住选择，重绘后不跳回"请选择"', () => {
  // 预演会触发整块重绘；不记住选择的话，用户接着点"自动整理"只会得到
  // "先选一个策略"，看起来像按钮坏了。
  assert.ok(UI_JS.includes('state.policy'), '选中的策略要存在 state 里');
  assert.ok(/sel\.value = state\.policy/.test(UI_JS), '重绘后要恢复选中项');
  assert.ok(/addEventListener\('change', function \(\) \{ state\.policy = sel\.value/.test(UI_JS), 'change 时写回 state');
});

test('UI_JS：摘令牌的局部变量不得遮蔽 qs() 工具函数', () => {
  // 回归（2026-11-10 实测）：`var qs = keep.toString()` 把 qs() 覆盖成字符串，
  // 点击「记忆」视图直接抛 "qs is not a function"，页面永远停在"加载中…"。
  // 这条缺陷此前一直存在，只是没有用例真的点开记忆视图。
  assert.equal(/var qs\s*=/.test(UI_JS), false, 'qs 是函数名，不得复用为局部变量');
  assert.ok(UI_JS.includes('var rest = keep.toString()'), '剩余参数用独立变量名');
});
