/**
 * 设计 token 与样式（design D7，色板来自本机 Archify skill 的真实模板变量）。
 *
 * 与 Archify 的一处有意偏离：它把金色当品牌强调色，这里把它降级为**语义色**。
 * Archify 面向"解释一个系统"，颜色用来区分节点类型；工作台面向"决定一件事"，
 * 颜色必须携带判断信息——金=待处理、紫=待审、青=层级、红=危险/分歧。
 *
 * 字体只用系统栈，不内嵌 Web Font：离线可用是硬要求，而十几个 woff2 的体积
 * 应该留给记忆正文。
 */

export const UI_CSS = String.raw`
:root {
  --bg: #020617; --surface: #0b1220; --surface-2: #111b2e; --border: #1e293b;
  --text: #e2e8f0; --text-dim: #94a3b8;
  --layer: #22d3ee; --warn: #fbbf24; --ok: #34d399; --pending: #a78bfa;
  --danger: #fb7185; --busy: #fb923c; --muted: #94a3b8;
  --radius: 10px;
  --font: ui-sans-serif, "Segoe UI", "Microsoft YaHei", sans-serif;
  --mono: ui-monospace, "Cascadia Mono", Consolas, monospace;
}
html[data-theme="light"] {
  --bg: #f4f5f7; --surface: #ffffff; --surface-2: #f8fafc; --border: #e2e8f0;
  --text: #0f172a; --text-dim: #64748b;
  --layer: #0e7490; --warn: #b45309; --ok: #047857; --pending: #6d28d9;
  --danger: #be123c; --busy: #c2410c; --muted: #64748b;
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font: 14px/1.55 var(--font);
}
a { color: var(--layer); }
code, pre, .mono { font-family: var(--mono); }
header {
  display: flex; align-items: baseline; gap: 16px;
  padding: 14px 20px; border-bottom: 1px solid var(--border); background: var(--surface);
}
header h1 { font-size: 15px; margin: 0; letter-spacing: .04em; font-weight: 600; }
header .sub { color: var(--text-dim); font-size: 12px; }
main { display: grid; grid-template-columns: 190px 1fr; min-height: calc(100vh - 53px); }
nav { border-right: 1px solid var(--border); padding: 12px 0; background: var(--surface); }
nav button {
  display: block; width: 100%; text-align: left; padding: 9px 18px;
  background: none; border: 0; border-left: 2px solid transparent;
  color: var(--text-dim); font: inherit; cursor: pointer;
}
nav button[aria-current="true"] { color: var(--text); border-left-color: var(--layer); background: var(--surface-2); }
nav button:hover { color: var(--text); }
section { padding: 18px 22px; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 18px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px 14px; }
.card .k { color: var(--text-dim); font-size: 11px; letter-spacing: .06em; text-transform: uppercase; }
.card .v { font-size: 22px; font-weight: 600; margin-top: 4px; }
.card.warn .v { color: var(--warn); }
.card.ok .v { color: var(--ok); }
.card.pending .v { color: var(--pending); }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
th { color: var(--text-dim); font-weight: 500; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; }
.chip {
  display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 11px;
  border: 1px solid currentColor; line-height: 1.6;
}
.chip.warn { color: var(--warn); } .chip.ok { color: var(--ok); }
.chip.pending { color: var(--pending); } .chip.danger { color: var(--danger); }
.chip.info { color: var(--layer); } .chip.muted { color: var(--muted); }
.empty { color: var(--text-dim); padding: 24px 0; font-size: 13px; }
.toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 14px; flex-wrap: wrap; }
input[type="search"], input[type="text"] {
  background: var(--surface-2); border: 1px solid var(--border); color: var(--text);
  border-radius: 8px; padding: 7px 10px; font: inherit; min-width: 240px;
}
button.action {
  background: var(--surface-2); border: 1px solid var(--border); color: var(--text);
  border-radius: 8px; padding: 7px 12px; font: inherit; cursor: pointer;
}
button.action:hover:not(:disabled) { border-color: var(--layer); }
button.action:disabled { opacity: .45; cursor: not-allowed; }
button.action.primary { border-color: var(--warn); color: var(--warn); }
:focus-visible { outline: 2px solid var(--layer); outline-offset: 2px; }
.warnbar {
  border: 1px solid var(--warn); border-radius: var(--radius); padding: 10px 14px;
  color: var(--warn); margin-bottom: 16px;
}
details summary { color: var(--text-dim); }
/* 右侧抽屉（任务 4.3）：整体覆盖在内容上，不挤压表格列宽。
   遮罩用固定透明度而不是变量：它要压暗的是它自己下面的内容，与主题无关。 */
.drawer-mask {
  position: fixed; inset: 0; z-index: 50;
  background: rgba(2, 6, 23, .58);
  display: flex; justify-content: flex-end;
}
.drawer {
  width: min(720px, 96vw); height: 100%;
  background: var(--surface); border-left: 1px solid var(--border);
  display: flex; flex-direction: column;
  box-shadow: -18px 0 40px rgba(0, 0, 0, .28);
}
.drawer-head {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 16px; border-bottom: 1px solid var(--border);
}
.drawer-head .close { margin-left: auto; }
.drawer-body { padding: 14px 16px 28px; overflow-y: auto; }
.drawer-body table { font-size: 12.5px; }
@media (max-width: 720px) {
  .drawer { width: 100%; }
}
@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}
@media (max-width: 720px) {
  main { grid-template-columns: 1fr; }
  nav { display: flex; overflow-x: auto; border-right: 0; border-bottom: 1px solid var(--border); }
  nav button { width: auto; border-left: 0; border-bottom: 2px solid transparent; }
  nav button[aria-current="true"] { border-left: 0; border-bottom-color: var(--layer); }
}
`;
