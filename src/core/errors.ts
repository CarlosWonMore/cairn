/**
 * Cairn 统一错误分类。所有模块抛出的业务错误都必须使用 CairnError，
 * CLI/MCP 依据 code 决定退出码与响应，不允许把内部细节直接抛给调用方。
 */

export type CairnErrorCode =
  // 作用域
  | 'E_SCOPE_INVALID'
  | 'E_SCOPE_MISMATCH'
  // 治理
  | 'E_SECRET_DETECTED'
  | 'E_INJECTION_SUSPECTED'
  | 'E_PLAN_INVALID'
  | 'E_PLAN_TAMPERED'
  | 'E_PLAN_EXPIRED'
  | 'E_APPROVAL_INVALID'
  | 'E_APPROVAL_EXPIRED'
  | 'E_APPROVAL_REPLAY'
  | 'E_TARGET_CHANGED'
  // 存储
  | 'E_NOT_FOUND'
  | 'E_DB_LOCKED'
  | 'E_MIGRATION_FAILED'
  | 'E_BACKUP_CORRUPT'
  | 'E_DEVICE_CLONED'
  | 'E_DEVICE_SUSPENDED'
  | 'E_READONLY'
  // 配置与投影
  | 'E_CONFIG_CONFLICT'
  | 'E_CONFIG_IO'
  | 'E_PROJECTION_LOOP'
  // 通用
  | 'E_VALIDATION'
  | 'E_FORBIDDEN'
  | 'E_CONFLICT_STATE'
  | 'E_IO'
  | 'E_INTERNAL';

/** CLI 稳定退出码（任务 5.1：区分成功、拒绝和故障）。 */
export const ExitCode = {
  /** 成功 */
  success: 0,
  /** 一般故障（内部错误、IO 失败） */
  failure: 1,
  /** 用法或参数校验错误 */
  usage: 2,
  /** 被治理规则拒绝（秘密、伪造审批、越权作用域、计划篡改等） */
  refused: 3,
  /** 状态冲突（同名外来条目、并发冲突未解决等） */
  conflict: 4,
  /** 环境不可用（数据库被锁、设备被暂停、迁移失败） */
  unavailable: 5,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

const EXIT_BY_CODE: Record<CairnErrorCode, ExitCodeValue> = {
  E_SCOPE_INVALID: ExitCode.usage,
  E_SCOPE_MISMATCH: ExitCode.refused,
  E_SECRET_DETECTED: ExitCode.refused,
  E_INJECTION_SUSPECTED: ExitCode.refused,
  E_PLAN_INVALID: ExitCode.usage,
  E_PLAN_TAMPERED: ExitCode.refused,
  E_PLAN_EXPIRED: ExitCode.refused,
  E_APPROVAL_INVALID: ExitCode.refused,
  E_APPROVAL_EXPIRED: ExitCode.refused,
  E_APPROVAL_REPLAY: ExitCode.refused,
  E_TARGET_CHANGED: ExitCode.conflict,
  E_NOT_FOUND: ExitCode.failure,
  E_DB_LOCKED: ExitCode.unavailable,
  E_MIGRATION_FAILED: ExitCode.unavailable,
  E_BACKUP_CORRUPT: ExitCode.unavailable,
  E_DEVICE_CLONED: ExitCode.unavailable,
  E_DEVICE_SUSPENDED: ExitCode.unavailable,
  E_READONLY: ExitCode.refused,
  E_CONFIG_CONFLICT: ExitCode.conflict,
  E_CONFIG_IO: ExitCode.failure,
  E_PROJECTION_LOOP: ExitCode.conflict,
  E_VALIDATION: ExitCode.usage,
  E_FORBIDDEN: ExitCode.refused,
  E_CONFLICT_STATE: ExitCode.conflict,
  E_IO: ExitCode.failure,
  E_INTERNAL: ExitCode.failure,
};

export function exitCodeFor(code: CairnErrorCode): ExitCodeValue {
  return EXIT_BY_CODE[code];
}

export class CairnError extends Error {
  readonly code: CairnErrorCode;
  /** 面向报告的结构化细节；绝不能包含记忆正文或秘密。 */
  readonly details?: Record<string, unknown>;

  constructor(code: CairnErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'CairnError';
    this.code = code;
    this.details = details;
  }

  get exitCode(): ExitCodeValue {
    return exitCodeFor(this.code);
  }

  toJSON(): { code: CairnErrorCode; message: string; details?: Record<string, unknown> } {
    return { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) };
  }
}

export function err(code: CairnErrorCode, message: string, details?: Record<string, unknown>): CairnError {
  return new CairnError(code, message, details);
}

export function isCairnError(e: unknown): e is CairnError {
  return e instanceof CairnError;
}
