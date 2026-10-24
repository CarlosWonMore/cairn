import { err, type CairnError } from '../core/errors.js';

/**
 * 远端能力接口（design D9 / 构想 §11.1）：本地 outbox 之上的可选上行边界。
 * 本变更不实现真实云端——接口按 §11.1 签名冻结，MVP 恒返回 NotConfiguredRemote；
 * delete 只供显式 purge 使用，因此不出现在常规同步接口里。
 */

/** 远端对象存储 + manifest 条件写的最小合同（后续变更接 ECS syncd / OBS）。 */
export interface RemoteStore {
  getObject(key: string): Promise<Uint8Array | null>;
  putImmutable(key: string, bytes: Uint8Array, hash: string): Promise<void>;
  list(prefix: string, cursor?: string): Promise<{ keys: string[]; nextCursor?: string }>;
  getManifest(space: string, device: string): Promise<unknown | null>;
  putManifest(space: string, device: string, manifest: unknown, expectedGeneration: number): Promise<void>;
  /** false = 一切上行调用都必须被拒绝（诚实降级，不假装同步成功）。 */
  readonly configured: boolean;
}

function notConfiguredError(): CairnError {
  return err('E_FORBIDDEN', 'remote_not_configured');
}

/**
 * 未配置远端：configured=false，每个方法都以 E_FORBIDDEN/remote_not_configured 拒绝。
 * 方法为 async：调用方一律以 Promise rejection 形式得到错误，不存在同步/异步两种抛出路径。
 */
export class NotConfiguredRemote implements RemoteStore {
  readonly configured = false;

  async getObject(_key: string): Promise<Uint8Array | null> {
    throw notConfiguredError();
  }

  async putImmutable(_key: string, _bytes: Uint8Array, _hash: string): Promise<void> {
    throw notConfiguredError();
  }

  async list(_prefix: string, _cursor?: string): Promise<{ keys: string[]; nextCursor?: string }> {
    throw notConfiguredError();
  }

  async getManifest(_space: string, _device: string): Promise<unknown | null> {
    throw notConfiguredError();
  }

  async putManifest(_space: string, _device: string, _manifest: unknown, _expectedGeneration: number): Promise<void> {
    throw notConfiguredError();
  }
}

/** 远端配置占位：真实云端接入属于后续变更（endpoint、credentialRef、vault 等届时定义）。 */
export interface RemoteStoreConfig {
  [key: string]: unknown;
}

/**
 * 取得远端实现。MVP 恒返 NotConfiguredRemote：任何 config 都不会假装接入云端，
 * doctor 如实报告 remote=not_configured（design Risks：不把 outbox 误解为已支持云同步）。
 */
export function getRemoteStore(_config?: RemoteStoreConfig): RemoteStore {
  return new NotConfiguredRemote();
}
