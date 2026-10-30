import { err } from '../core/errors.js';
import type { DuplicateHit } from '../governance/dedup.js';

/**
 * 写入时判断（design D6 / D10）：判断是**建议**，不是授权。
 *
 * 它只回答"这条值不值得记"，不回答"允许不允许记"。后者一律由写入参数、作用域解析与
 * 策略白名单决定。因此这里**没有**任何能改敏感度、改作用域、或构成审批凭证的字段——
 * 不是没实现，是不允许存在。
 */

export const JUDGEMENT_CONFIDENCES = ['high', 'medium', 'low'] as const;
export type JudgementConfidence = (typeof JUDGEMENT_CONFIDENCES)[number];

export const DEDUPE_INTENTS = ['merge', 'keep_both'] as const;
export type DedupeIntent = (typeof DEDUPE_INTENTS)[number];

export type VerdictKind = 'keep' | 'skip' | 'merge_into';

export const RATIONALE_MAX = 500;

export interface Judgement {
  verdict: VerdictKind;
  /** 仅 verdict === 'merge_into' 时非空。 */
  mergeIntoId: string | null;
  confidence: JudgementConfidence;
  rationale: string;
  dedupe: DedupeIntent;
}

const MERGE_INTO_PREFIX = 'merge_into:';

/**
 * 解析并校验判断。非法值一律拒绝，MUST NOT 用默认值补齐——
 * 补齐会把"调用方说错了"变成"系统替它选了一个"，而这两件事在审计里必须能分开。
 */
export function parseJudgement(raw: unknown): Judgement {
  if (raw == null) throw err('E_VALIDATION', '判断不能为空');
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw err('E_VALIDATION', '判断必须是对象');
  }
  const obj = raw as Record<string, unknown>;

  const verdictRaw = obj['verdict'];
  if (typeof verdictRaw !== 'string' || verdictRaw.trim().length === 0) {
    throw err('E_VALIDATION', '判断缺少 verdict（keep / skip / merge_into:<记忆id>）');
  }
  const verdictText = verdictRaw.trim();
  let verdict: VerdictKind;
  let mergeIntoId: string | null = null;
  if (verdictText === 'keep' || verdictText === 'skip') {
    verdict = verdictText;
  } else if (verdictText.startsWith(MERGE_INTO_PREFIX)) {
    const target = verdictText.slice(MERGE_INTO_PREFIX.length).trim();
    if (target.length === 0) {
      throw err('E_VALIDATION', 'merge_into 必须指定目标记忆 id');
    }
    verdict = 'merge_into';
    mergeIntoId = target;
  } else {
    throw err('E_VALIDATION', `verdict 非法: ${verdictText}（只允许 keep / skip / merge_into:<记忆id>）`);
  }

  const confidenceRaw = obj['confidence'];
  if (typeof confidenceRaw !== 'string' || !(JUDGEMENT_CONFIDENCES as readonly string[]).includes(confidenceRaw)) {
    throw err('E_VALIDATION', `confidence 缺失或非法（只允许 ${JUDGEMENT_CONFIDENCES.join(' / ')}），不能省略`);
  }
  const confidence = confidenceRaw as JudgementConfidence;

  const rationaleRaw = obj['rationale'];
  if (typeof rationaleRaw !== 'string' || rationaleRaw.trim().length === 0) {
    throw err('E_VALIDATION', '判断必须给出一句话理由（rationale），不能为空');
  }
  const rationale = rationaleRaw.trim();
  if (rationale.length > RATIONALE_MAX) {
    throw err('E_VALIDATION', `rationale 超过 ${RATIONALE_MAX} 字符上限`);
  }

  const dedupeRaw = obj['dedupe'];
  let dedupe: DedupeIntent = 'merge';
  if (dedupeRaw != null) {
    if (typeof dedupeRaw !== 'string' || !(DEDUPE_INTENTS as readonly string[]).includes(dedupeRaw)) {
      throw err('E_VALIDATION', `dedupe 非法: ${String(dedupeRaw)}（只允许 ${DEDUPE_INTENTS.join(' / ')}）`);
    }
    dedupe = dedupeRaw as DedupeIntent;
  }

  if (dedupe === 'keep_both' && verdict === 'merge_into') {
    throw err('E_VALIDATION', 'keep_both 与 merge_into 互斥：一个要求并存，一个要求并入指定记忆');
  }

  return { verdict, mergeIntoId, confidence, rationale, dedupe };
}

/** CLI 用扁平参数拼装，复杂到需要对象时由调用方直接传 JSON。 */
export function judgementFromFlags(flags: Record<string, string | boolean | undefined>): Judgement | null {
  const verdict = flags['judgement'];
  if (verdict == null || typeof verdict !== 'string') return null;
  const merged: Record<string, unknown> = { verdict };
  for (const key of ['confidence', 'rationale', 'dedupe'] as const) {
    const v = flags[key];
    if (typeof v === 'string') merged[key] = v;
  }
  return parseJudgement(merged);
}

export type WriteAction = 'insert' | 'merge' | 'promote_candidate' | 'skip' | 'candidate';

export interface WriteDecision {
  action: WriteAction;
  /** merge 时指向被并入的记忆；其余为 null。 */
  targetMemoryId: string | null;
  /** 落审计的判定依据，形如 judgement_skip_medium / duplicate_active。 */
  basis: string;
}

export interface DecideWriteInput {
  judgement: Judgement | null;
  duplicate: DuplicateHit | null;
}

/**
 * 判断 + 查重 → 落库动作。纯函数，不读库不写库。
 *
 * 关键取舍：**没有判断时也要查重**。写入路径的重复不是判断出来的，是比对出来的；
 * 先把这件事做掉，才谈得上"只有一条"。
 */
export function decideWrite(input: DecideWriteInput): WriteDecision {
  const { judgement, duplicate } = input;

  if (judgement?.verdict === 'skip') {
    if (judgement.confidence === 'high') {
      return { action: 'skip', targetMemoryId: null, basis: 'judgement_skip_high' };
    }
    // 低置信的"不值得记"不足以丢弃，也不足以新建：既有 active 就并进去，没有就降为候选。
    if (duplicate?.status === 'active') {
      return { action: 'merge', targetMemoryId: duplicate.memoryId, basis: `judgement_skip_${judgement.confidence}_existing_active` };
    }
    return { action: 'candidate', targetMemoryId: null, basis: `judgement_skip_${judgement.confidence}` };
  }

  if (judgement?.verdict === 'merge_into') {
    return { action: 'merge', targetMemoryId: judgement.mergeIntoId, basis: 'judgement_merge_into' };
  }

  // verdict = keep，或没有判断：都走同一条查重路径。
  if (judgement?.dedupe === 'keep_both') {
    return { action: 'insert', targetMemoryId: null, basis: 'judgement_keep_both' };
  }
  if (duplicate) {
    return duplicate.status === 'active'
      ? { action: 'merge', targetMemoryId: duplicate.memoryId, basis: 'duplicate_active' }
      : { action: 'promote_candidate', targetMemoryId: duplicate.memoryId, basis: 'duplicate_candidate' };
  }
  return { action: 'insert', targetMemoryId: null, basis: judgement ? 'judgement_keep' : 'no_duplicate' };
}

/** 审计用的紧凑描述：不落原文，只落结论与理由。 */
export function describeJudgement(j: Judgement): string {
  const target = j.mergeIntoId ? `→${j.mergeIntoId}` : '';
  return `${j.verdict}${target}/${j.confidence}/${j.dedupe}`;
}
