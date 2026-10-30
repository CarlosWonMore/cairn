import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { CairnStore } from '../../store/open.js';
import { nowIso } from '../../core/time.js';
import { buildModel, ConsoleModel, ViewMode } from './model.js';
import { renderShell } from './assets/page.js';
import { safeJsonForScript } from './text.js';

/**
 * 静态导出（design D8）。
 *
 * 默认输出**完整正文**（含 sensitivity='sensitive' 的记忆），这是用户的明确取舍：
 * 完整的可审计性优先于默认保守。代价用三层告知承担，而不是用技术阻断假装安全：
 * 1. 文件名追加 `-personal`；
 * 2. 文件头与页面顶部显式警示；
 * 3. 导出完成时 stdout 打印条目数与字符量。
 *
 * 需要外发时用 `--redact` 回到全掩码。只有一个反向开关，不做 `--include-blocked`
 * 之类的组合开关——两个开关同时存在会产生"我打开了 A 却以为也打开了 B"的歧义。
 *
 * 关于 blocked 条目：它们**在导入阶段就被替换成 `[blocked:kind]` 占位符**，原文从未
 * 入库（import.ts:blockedPlaceholder）。所以无论开关怎么设都导不出那些原文；
 * 导出会如实标注这一点，而不是让读者以为"这里被工具藏起来了"。
 */

export interface ExportUiOptions {
  outFile?: string;
  redact?: boolean;
  mode?: ViewMode;
  /** 体积超限时的降级阈值，默认 8 MB；测试可调小。 */
  maxBytes?: number;
  /** 降级时保留正文的条目数，默认 500。 */
  degradeKeepItems?: number;
}

export interface ExportUiResult {
  outFile: string;
  bytes: number;
  counts: { memories: number; archives: number; items: number; batches: number; plans: number };
  redacted: boolean;
  /** 因体积降级而被裁掉正文的条目数（0 表示未降级）。 */
  degradedItems: number;
  warnings: string[];
}

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_DEGRADE_KEEP = 500;

export function exportConsoleHtml(store: CairnStore, opts: ExportUiOptions = {}): ExportUiResult {
  const redact = opts.redact ?? false;
  const mode = opts.mode ?? 'full';
  const warnings: string[] = [];
  let model = buildModel(store, { mode, redact, includeItems: true });
  let degradedItems = 0;

  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  let html = renderExportPage(model);
  if (Buffer.byteLength(html, 'utf8') > maxBytes) {
    const keep = opts.degradeKeepItems ?? DEFAULT_DEGRADE_KEEP;
    model = degrade(model, keep);
    degradedItems = Math.max(0, (model.items?.length ?? 0) - keep);
    html = renderExportPage(model);
    warnings.push(
      `产物超过 ${(maxBytes / 1024 / 1024).toFixed(1)} MB，已降级为"元数据 + 前 ${keep} 条正文"，${degradedItems} 条正文被裁掉（文件头已标注）`,
    );
  }

  // 文件名层也在这里收口：CLI 与 API 两条路径都不该漏掉 -personal 后缀。
  const outFile = normalizePersonalName(opts.outFile ?? defaultOutFile(store));
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, html, 'utf8');

  const blocked = Number(store.db.scalar("SELECT COUNT(*) AS n FROM import_item WHERE scan_state = 'blocked'") ?? 0);
  if (blocked > 0 && !redact) {
    warnings.push(
      `${blocked} 条 blocked 条目只能给出占位符与扫描类别：它们的原文在导入阶段已按安全策略丢弃，不在库中`,
    );
  }

  return {
    outFile,
    bytes: Buffer.byteLength(html, 'utf8'),
    counts: {
      memories: model.memories.length,
      archives: model.archives.length,
      items: model.items?.length ?? 0,
      batches: model.batches.length,
      plans: model.plans.length,
    },
    redacted: redact,
    degradedItems,
    warnings,
  };
}

function degrade(model: ConsoleModel, keep: number): ConsoleModel {
  const items = model.items ?? [];
  return {
    ...model,
    items: items.map((it, i) =>
      i < keep
        ? it
        : {
            ...it,
            content: { masked: false, text: null, length: it.content.length, hashPrefix: it.content.hashPrefix, truncated: true },
          },
    ),
  };
}

/** 默认文件名：`cairn-preview-personal.html`；已有同名则追加时间戳避免覆盖。 */
function defaultOutFile(store: CairnStore): string {
  const stamp = nowIso().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  return join(store.paths.home, 'console', `cairn-preview-personal-${stamp}.html`);
}

/** 保证导出文件名带 -personal：用户显式给了路径就尊重，只在其 stem 上补后缀。 */
export function normalizePersonalName(outFile: string): string {
  const ext = extname(outFile) || '.html';
  const stem = basename(outFile, ext);
  if (stem.includes('-personal')) return outFile;
  return join(dirname(outFile), `${stem}-personal${ext}`);
}

export function renderExportPage(model: ConsoleModel): string {
  const banner = model.redacted
    ? '此文件为脱敏导出：sensitive 记忆正文已替换为掩码。'
    : '此文件含明文本地记忆，请勿外传。默认导出包含完整正文（含 sensitive 标记的记忆）。';
  const blockedNote =
    'blocked 条目只显示占位符与扫描类别：这些条目的原文在导入阶段已按安全策略物理丢弃，不在库中，任何开关都取不回来。';
  return renderShell({
    title: 'cairn 记忆预览（静态）',
    subtitle: `静态预览 · 生成于 ${model.generatedAt} · 模式 ${model.mode} · 只读`,
    banners: [banner, blockedNote],
    modelJson: safeJsonForScript(model),
  });
}

