/** Cairn 领域类型——所有模块共享的唯一事实源。 */

// ---------------------------------------------------------------------------
// 记忆本体
// ---------------------------------------------------------------------------

export const MEMORY_KINDS = [
  'instruction',
  'preference',
  'fact',
  'decision',
  'episode',
  'procedure',
  'environment',
] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const MEMORY_STATUSES = [
  'candidate',
  'active',
  'conflicted',
  'superseded',
  'archived',
  'tombstoned',
] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

export const AUTHORITIES = [
  'user_explicit',
  'user_confirmed',
  'agent_inferred',
  'imported_unverified',
] as const;
export type Authority = (typeof AUTHORITIES)[number];

/** 敏感度：normal / sensitive 可入库；blocked 是扫描结论，拒绝入库（触发器兜底）。 */
export type Sensitivity = 'normal' | 'sensitive';

export interface EvidenceInput {
  evidenceKind: 'message_range' | 'file_ref' | 'import_ref' | 'url' | 'tool_output' | 'user_statement';
  sourceAgent?: string;
  sessionId?: string;
  importArchiveId?: string;
  locator?: string;
  excerptHash?: string;
  trustLevel: 'authoritative' | 'user_supplied' | 'third_party' | 'untrusted';
}

export interface AddMemoryInput {
  kind: MemoryKind;
  content: string;
  scopeId: string;
  authority: Authority;
  createdBy: string;
  confidence?: number;
  sourceAgent?: string | null;
  sourceSessionId?: string | null;
  sourceImportBatchId?: string | null;
  sourceMessageRange?: string | null;
  evidence?: EvidenceInput[];
  observedAt?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  expiresAt?: string | null;
  sensitivity?: Sensitivity;
}

export interface MemoryRecord {
  id: string;
  ownerId: string;
  kind: MemoryKind;
  content: string;
  normalizedContent: string;
  scopeId: string;
  status: MemoryStatus;
  authority: Authority;
  confidence: number;
  sourceAgent: string | null;
  sourceSessionId: string | null;
  sourceImportBatchId: string | null;
  sourceMessageRange: string | null;
  observedAt: string;
  validFrom: string | null;
  validTo: string | null;
  lastVerifiedAt: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  sensitivity: Sensitivity;
  currentRevisionId: string | null;
  contentHash: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface RevisionRecord {
  id: string;
  memoryId: string;
  seq: number;
  parentRevisionIds: string[];
  content: string;
  contentHash: string;
  scopeId: string;
  status: MemoryStatus;
  authority: Authority;
  author: string;
  deviceId: string;
  reason: string | null;
  createdAt: string;
}

export interface EvidenceRecord {
  id: string;
  memoryId: string;
  revisionId: string | null;
  evidenceKind: EvidenceInput['evidenceKind'];
  sourceAgent: string | null;
  sessionId: string | null;
  importArchiveId: string | null;
  locator: string | null;
  excerptHash: string | null;
  trustLevel: EvidenceInput['trustLevel'];
  createdAt: string;
}

export const RELATION_TYPES = ['supersedes', 'contradicts', 'related_to'] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

// ---------------------------------------------------------------------------
// 检索结果（scoped-retrieval spec：来源可解释）
// ---------------------------------------------------------------------------

export interface SearchResultRecord {
  memory: MemoryRecord;
  /** 命中通道：fts（索引）或 like（有界回退） */
  matchedBy: 'fts' | 'like';
  score: number;
  /** 未解决冲突 id（当 memory.status === 'conflicted'） */
  conflictId?: string;
  /** 未验证导入不得显示为用户确认事实（spec agent-onboarding） */
  unverifiableImport: boolean;
  expired: boolean;
}

// ---------------------------------------------------------------------------
// 秘密与注入扫描契约（实现位于 src/core/secrets.ts，由治理与导入模块调用）
// ---------------------------------------------------------------------------

export type SecretKind =
  | 'private_key'
  | 'aws_access_key_id'
  | 'aws_secret_access_key'
  | 'github_token'
  | 'generic_api_key'
  | 'bearer_token'
  | 'jwt'
  | 'password_assignment'
  | 'connection_string';

export interface SecretFinding {
  kind: SecretKind;
  /** 匹配在原文中的位置；报告仅保留类型与位置摘要，不回显正文。 */
  start: number;
  end: number;
  /** 打码摘要：只暴露首尾各 2 字符，中间用 *** 代替。 */
  masked: string;
}

export type InjectionKind =
  | 'ignore_instructions'
  | 'exfiltrate_memory'
  | 'escalate_scope'
  | 'role_override'
  | 'fake_approval';

export interface InjectionFinding {
  kind: InjectionKind;
  start: number;
  end: number;
  /** 命中的规则名（不含正文）。 */
  rule: string;
}

export interface SecretScanResult {
  findings: SecretFinding[];
  injectionFindings: InjectionFinding[];
  clean: boolean;
}

/**
 * 秘密/注入扫描器契约。任何进入 Agent 批次、计划应用、投影或 outbox
 * 的不可信文本都必须先经过本入口（memory-governance spec）。
 */
export interface SecretScanner {
  scan(text: string): SecretScanResult;
}
