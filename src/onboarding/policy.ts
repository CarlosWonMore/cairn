import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { err } from '../core/errors.js';
import { canonicalJson, sha256Hex } from '../core/hash.js';
import { nowIso } from '../core/time.js';
import type { Sensitivity } from '../core/types.js';

/**
 * 自动整理策略（design D1 / D2）。
 *
 * 策略是"人一次性签发、确定性代码按条件代签审批"的凭据。因此这里的原则是：
 * **宁可拒绝，不做宽松默认**。缺字段、多字段、类型不对、值越界，一律终止并说清是哪一项，
 * 不替调用方补一个"看起来合理"的值——补出来的策略在审计里与真实意图无法区分。
 */

export const POLICY_DIR = 'policy';

/** 签发通道只有两条：终端 CLI 与本机回环控制台。MCP 不在其中。 */
export const POLICY_CHANNELS = ['cli', 'console'] as const;
export type PolicyChannel = (typeof POLICY_CHANNELS)[number];

export const POLICY_CONDITIONS = [
  'scan_state',
  'scope',
  'sensitivity',
  'conflict',
  'ai_agreement',
  'confidence',
  'duplicate',
  'create',
] as const;
export type PolicyCondition = (typeof POLICY_CONDITIONS)[number];

export interface PolicySpec {
  id: string;
  /** 允许自动写入的作用域（preset 名或 scope id）。空集合等于策略无效，直接拒绝签发。 */
  allowedScopes: string[];
  /** 允许的最高敏感度：normal 表示只放普通内容，sensitive 表示也放敏感内容。 */
  maxSensitivity: Sensitivity;
  /** 是否要求规则层与 AI 层的动作完全一致才放行。 */
  requireAiAgreement: boolean;
  /** 是否允许自动创建新记忆（false 时只允许并入既有记忆）。 */
  allowCreate: boolean;
  /** AI 判断的最低置信度（0..1）；低于此值转人工。 */
  minConfidence: number;
  /** 人写的备注，说明这份策略打算用来做什么。 */
  note: string;
}

export interface SignedPolicy {
  spec: PolicySpec;
  policyHash: string;
  signedAt: string;
  signedVia: PolicyChannel;
  /** 显式撤销时间；非 null 时该策略不可再用于自动整理。 */
  revokedAt: string | null;
}

const SPEC_KEYS = new Set([
  'id',
  'allowedScopes',
  'maxSensitivity',
  'requireAiAgreement',
  'allowCreate',
  'minConfidence',
  'note',
]);

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

// ------------------------------------------------------------------ 校验与哈希

export function validatePolicySpec(raw: unknown): PolicySpec {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw err('E_VALIDATION', '策略必须是对象');
  }
  const obj = raw as Record<string, unknown>;

  const unknown = Object.keys(obj).filter((k) => !SPEC_KEYS.has(k));
  if (unknown.length > 0) {
    // 静默忽略拼错的字段，等于让"我写了 allowedScope"看起来生效了实际没有。
    throw err('E_VALIDATION', `策略含未知字段: ${unknown.join(', ')}`, { unknown });
  }

  const id = obj['id'];
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    throw err('E_VALIDATION', '策略 id 非法：只允许小写字母数字与 ._-，长度 1-64，且以字母数字开头');
  }

  const scopesRaw = obj['allowedScopes'];
  if (!Array.isArray(scopesRaw) || scopesRaw.length === 0) {
    throw err('E_VALIDATION', '策略必须声明非空的 allowedScopes：空的允许集合没有任何语义');
  }
  const allowedScopes = scopesRaw.map((s) => {
    if (typeof s !== 'string' || s.trim().length === 0) {
      throw err('E_VALIDATION', 'allowedScopes 只能包含非空字符串');
    }
    return s.trim();
  });

  const maxSensitivity = obj['maxSensitivity'];
  if (maxSensitivity !== 'normal' && maxSensitivity !== 'sensitive') {
    throw err('E_VALIDATION', "maxSensitivity 必须是 'normal' 或 'sensitive'");
  }

  const requireAiAgreement = obj['requireAiAgreement'];
  if (typeof requireAiAgreement !== 'boolean') {
    throw err('E_VALIDATION', 'requireAiAgreement 必须是布尔值（不接受 "true" 这类字符串）');
  }

  const allowCreate = obj['allowCreate'];
  if (typeof allowCreate !== 'boolean') {
    throw err('E_VALIDATION', 'allowCreate 必须是布尔值');
  }

  const minConfidence = obj['minConfidence'];
  if (typeof minConfidence !== 'number' || !Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1) {
    throw err('E_VALIDATION', 'minConfidence 必须是 [0,1] 内的数字');
  }

  const note = obj['note'];
  if (typeof note !== 'string') {
    throw err('E_VALIDATION', 'note 必须是字符串（可为空，但不能缺）');
  }

  return { id, allowedScopes, maxSensitivity, requireAiAgreement, allowCreate, minConfidence, note };
}

/** 规范化序列化后取 sha256：字段顺序与空白不影响结果，改动任一字段必然改变哈希。 */
export function policyHashOf(spec: PolicySpec): string {
  const ordered: Record<string, unknown> = {
    id: spec.id,
    allowedScopes: [...spec.allowedScopes],
    maxSensitivity: spec.maxSensitivity,
    requireAiAgreement: spec.requireAiAgreement,
    allowCreate: spec.allowCreate,
    minConfidence: spec.minConfidence,
    note: spec.note,
  };
  return sha256Hex(canonicalJson(ordered));
}

// ------------------------------------------------------------------ 落盘

export function policyDir(home: string): string {
  return join(home, POLICY_DIR);
}

export function policyPath(home: string, id: string): string {
  return join(policyDir(home), `${id}.json`);
}

export function signPolicy(
  home: string,
  raw: unknown,
  opts: { via: PolicyChannel; force?: boolean } = { via: 'cli' },
): SignedPolicy {
  const spec = validatePolicySpec(raw);
  const file = policyPath(home, spec.id);
  if (existsSync(file) && opts.force !== true) {
    throw err('E_VALIDATION', `策略 ${spec.id} 已存在；改签需显式 --force（会替换既有签发，旧哈希随之失效）`);
  }
  const signed: SignedPolicy = {
    spec,
    policyHash: policyHashOf(spec),
    signedAt: nowIso(),
    signedVia: opts.via,
    revokedAt: null,
  };
  mkdirSync(policyDir(home), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(signed, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
  return signed;
}

/**
 * 读取并重算哈希。不一致即拒绝使用，不降级——
 * 策略文件被人改过而系统照用，等于这条授权路径没有边界。
 */
export function loadPolicy(home: string, id: string): SignedPolicy {
  const file = policyPath(home, id);
  if (!existsSync(file)) {
    throw err('E_NOT_FOUND', `策略不存在: ${id}（先执行 cairn policy sign）`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw err('E_VALIDATION', `策略文件无法解析: ${id}`, { cause: String(e) });
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw err('E_VALIDATION', `策略文件结构非法: ${id}`);
  }
  const obj = parsed as Record<string, unknown>;
  const spec = validatePolicySpec(obj['spec']);
  const recorded = obj['policyHash'];
  const actual = policyHashOf(spec);
  if (typeof recorded !== 'string' || recorded !== actual) {
    throw err('E_FORBIDDEN', `策略 ${id} 的内容与签发哈希不一致，已拒绝使用（改动后必须重新签发）`, {
      recorded,
      actual,
    });
  }
  return {
    spec,
    policyHash: actual,
    signedAt: String(obj['signedAt'] ?? ''),
    signedVia: (obj['signedVia'] === 'console' ? 'console' : 'cli') as PolicyChannel,
    revokedAt: typeof obj['revokedAt'] === 'string' ? obj['revokedAt'] : null,
  };
}

/** 可运行时使用的策略：存在、哈希一致、未被撤销。 */
export function requireUsablePolicy(home: string, id: string): SignedPolicy {
  const p = loadPolicy(home, id);
  if (p.revokedAt != null) {
    throw err('E_FORBIDDEN', `策略 ${id} 已于 ${p.revokedAt} 撤销，不能用于自动整理`);
  }
  return p;
}

export function listPolicies(home: string): SignedPolicy[] {
  const dir = policyDir(home);
  if (!existsSync(dir)) return [];
  const out: SignedPolicy[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const id = name.slice(0, -'.json'.length);
    try {
      out.push(loadPolicy(home, id));
    } catch {
      // 坏文件不该让整个列表不可用；调用方要看细节时用 policy show。
    }
  }
  return out.sort((a, b) => a.spec.id.localeCompare(b.spec.id));
}

export function revokePolicy(home: string, id: string): SignedPolicy {
  const p = loadPolicy(home, id);
  if (p.revokedAt != null) return p;
  const next: SignedPolicy = { ...p, revokedAt: nowIso() };
  const file = policyPath(home, id);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
  return next;
}

// ------------------------------------------------------------------ 条件判定

const SENSITIVITY_RANK: Record<Sensitivity, number> = { normal: 0, sensitive: 1 };

/** 供策略用的置信度换算；与 judgement 的 high/medium/low 一一对应。 */
export const CONFIDENCE_SCORE = { high: 0.9, medium: 0.6, low: 0.3 } as const;

export interface PolicyCandidate {
  itemId: string;
  scanState: 'clean' | 'blocked';
  /** 将被写入的作用域（preset 名或 scope id）。 */
  scope: string;
  sensitivity: Sensitivity;
  /** 它将并入的目标记忆是否处于未解决冲突。 */
  hasConflict: boolean;
  /** 规则层动作。 */
  ruleAction: string;
  /** AI 层动作；未产出判断时为 null。 */
  aiAction: string | null;
  /** AI 置信度 0..1；未产出判断时为 null。 */
  aiConfidence: number | null;
  /** 正文是否为重复（已存在同作用域同内容）。 */
  isDuplicate: boolean;
  /** 该操作是否会新建记忆（false 表示并入既有）。 */
  wouldCreate: boolean;
}

export interface PolicyVerdict {
  ok: boolean;
  failedCondition: PolicyCondition | null;
  detail: string;
}

export function evaluatePolicy(candidate: PolicyCandidate, policy: SignedPolicy): PolicyVerdict {
  const spec = policy.spec;
  const fail = (condition: PolicyCondition, detail: string): PolicyVerdict => ({
    ok: false,
    failedCondition: condition,
    detail,
  });

  // 1. 扫描状态：最廉价，先挡掉注定不能进库的。
  if (candidate.scanState !== 'clean') {
    return fail('scan_state', `扫描状态为 ${candidate.scanState}`);
  }

  // 2. 作用域白名单。
  if (!spec.allowedScopes.includes(candidate.scope)) {
    return fail('scope', `作用域 ${candidate.scope} 不在允许集内（${spec.allowedScopes.join(', ')}）`);
  }

  // 3. 敏感度：序数比较，超限即拒，不降级。
  if (SENSITIVITY_RANK[candidate.sensitivity] > SENSITIVITY_RANK[spec.maxSensitivity]) {
    return fail('sensitivity', `敏感度 ${candidate.sensitivity} 高于上限 ${spec.maxSensitivity}`);
  }

  // 4. 未解决冲突。
  if (candidate.hasConflict) {
    return fail('conflict', '目标记忆存在未解决冲突');
  }

  // 5. 两层一致：到这里才碰 AI 结果。前面三项本地可判，先失败先返回，
  //    避免为注定被拒的条目白等一次模型判断。
  if (spec.requireAiAgreement) {
    if (candidate.aiAction == null) {
      return fail('ai_agreement', '尚无 AI 判断，无法确认两层一致');
    }
    if (candidate.aiAction !== candidate.ruleAction) {
      return fail('ai_agreement', `规则层 ${candidate.ruleAction} 与 AI 层 ${candidate.aiAction} 不一致`);
    }
  }

  // 6. 置信度门槛：有判断才比较。没有判断时是否放行由上一项（requireAiAgreement）决定，
  //    否则 requireAiAgreement=false 会被这一项抵消，等于开关不生效。
  if (candidate.aiConfidence != null && candidate.aiConfidence < spec.minConfidence) {
    return fail('confidence', `AI 置信度 ${candidate.aiConfidence} 低于门槛 ${spec.minConfidence}`);
  }

  // 7. 重复：内容已经在同一作用域里，唯一正确的动作是并入。
  //    这里不是在问"要不要允许创建"，而是在问"规则层给对了动作没有"。
  if (candidate.isDuplicate && candidate.ruleAction !== 'merge') {
    return fail('duplicate', '内容已存在于该作用域，但规则层未给出合并动作');
  }

  // 8. 新建许可：只有真的要新建一条时才检查。
  if (candidate.wouldCreate && !spec.allowCreate) {
    return fail('create', '策略未授权自动创建新记忆');
  }

  return { ok: true, failedCondition: null, detail: '全部条件满足' };
}
