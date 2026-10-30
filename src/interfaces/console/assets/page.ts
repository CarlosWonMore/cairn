/**
 * 页面外壳（工作台与静态导出共用）。
 *
 * 资源全部内联：不引用任何 http(s) 外部资源，也不引用独立 .css/.js 文件——
 * 后者需要 tsc 之外的拷贝步骤，漏拷时构建不报错、运行时才表现为"页面没样式"
 * 或"按钮点了没反应"。写成 TS 常量就由编译器直接产出，npm pack 不会漏。
 */

import { escapeHtml } from '../text.js';
import { UI_CSS } from './ui-css.js';
import { UI_JS } from './ui-js.js';

export interface ShellOptions {
  title: string;
  subtitle: string;
  banners?: string[];
  /** 静态导出：把模型 JSON 内联进页面，并把 body 标为 data-static。 */
  modelJson?: string;
}

export function renderShell(opts: ShellOptions): string {
  const banners = (opts.banners ?? []).map((b) => `<div class="warnbar">${escapeHtml(b)}</div>`).join('');
  const staticAttr = opts.modelJson != null ? ' data-static="1"' : '';
  const modelScript =
    opts.modelJson != null ? `<script type="application/json" id="cairn-model">${opts.modelJson}</script>` : '';
  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(opts.title)}</title>
<style>${UI_CSS}</style>
</head>
<body${staticAttr}>
<header>
  <h1>cairn</h1>
  <span class="sub">${escapeHtml(opts.subtitle)}</span>
</header>
<main>
  <nav id="nav"></nav>
  <section id="view">${banners}<div class="empty">加载中…</div></section>
</main>
${modelScript}
<script>${UI_JS}</script>
</body>
</html>`;
}

export { UI_CSS, UI_JS };
