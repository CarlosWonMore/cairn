/**
 * Cairn 首次初始化（onboarding）公共入口。
 *
 * 两层导入模型（spec agent-onboarding）：
 *
 * 1. 档案层 —— importSnapshot()：授权后创建带来源哈希的不可变快照并登记
 *    条目，导入完成内容即本地可检索（imported_unverified + local_only）。
 *    全程确定性代码，不依赖任何模型；模型不可用或整理任务中断时，用户仍可
 *    检索、导出原始档案，未验证状态保持清晰。
 *
 * 2. 晋升层 —— batches.ts：当前 Agent 按批次分块（nextBatchChunk 的持久化
 *    游标）读取 clean 且未晋升的条目生成治理建议，经治理计划 + 真实审批后
 *    才晋升为正式记忆（markItemPromoted）。会话中断后可在新会话继续未完成
 *    批次，不重复已应用操作，也不扩大原授权范围。晋升状态由审计事件承载
 *    （审计即状态，schema 冻结不加列）。
 *
 * 秘密与注入阻断（spec memory-governance）：命中扫描的条目 scan_state='blocked'，
 * 以占位符入库、原文仅存于不可变快照文件，永不进入批次、日志或上行内容。
 */

export { importSnapshot, parseMarkdownItems, DEFAULT_MAX_ITEM_BYTES } from './import.js';
export type { ImportSourceInput, ImportOutcome } from './import.js';
export {
  assignBatch,
  batchProgress,
  nextBatchChunk,
  markItemPromoted,
  markItemSkipped,
  listSkippedItems,
} from './batches.js';
export type { SkipBasis, SkippedItem } from './batches.js';
export type { BatchProgress, BatchChunkItem } from './batches.js';
