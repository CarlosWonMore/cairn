import { CairnStore } from '../store/open.js';
import { RemoteStore } from '../jobs/remote.js';
import { err } from '../core/errors.js';
import { VaultConfig, loadVaultConfig, saveVaultConfig, ENV } from './vault.js';
import { VaultKeys } from './cryptoutil.js';
import { generateVaultKeys, saveKeys, loadKeys, exportRecoveryMaterial } from './cryptoutil.js';
import { registerHandler } from '../jobs/worker.js';
import { syncPush } from './push.js';
import { syncPull } from './pull.js';
import { PERSONAL_SPACE_KEY } from './vault.js';

/**
 * vault 编排：配置 → RemoteStore 构造 → worker 注册 → CLI 动作。
 * 未配置（vault.json 不存在）时一切同步动作以 E_VALIDATION 明确报错，
 * 本地行为与 MVP 完全一致。
 */

export function buildRemoteStore(vault: VaultConfig): RemoteStore {
  const env = process.env;
  if (vault.provider === 'obs') {
    const ak = env[ENV.obsAk];
    const sk = env[ENV.obsSk];
    if (!vault.obs) throw err('E_VALIDATION', 'vault.json 缺少 obs 配置');
    if (!ak || !sk) {
      throw err('E_FORBIDDEN', `缺少环境变量 ${ENV.obsAk} / ${ENV.obsSk}；凭据只经环境变量注入，不落盘`);
    }
    // 延迟导入：obs-store 由并行模块提供
    return newObsStore({ endpoint: vault.obs.endpoint, bucket: vault.obs.bucket, prefix: vault.obs.prefix, accessKeyId: ak, secretAccessKey: sk });
  }
  if (vault.provider === 'syncd') {
    if (!vault.syncd) throw err('E_VALIDATION', 'vault.json 缺少 syncd 配置');
    const token = env[ENV.syncdToken];
    if (!token) throw err('E_FORBIDDEN', `缺少环境变量 ${ENV.syncdToken}`);
    // vault 段并入键空间（与 OBS 布局对齐）：同一 syncd 多 vault 互不可见
    return newSyncdStore({ baseUrl: vault.syncd.baseUrl, token, prefix: `vaults/${vault.vaultId}/` });
  }
  throw err('E_VALIDATION', `未知 provider: ${String((vault as { provider?: string }).provider)}`);
}

// 延迟绑定（模块由并行实现提供）
import { ObsRemoteStore } from './obs-store.js';
import { SyncdRemoteStore } from './syncd-store.js';

function newObsStore(cfg: ConstructorParameters<typeof ObsRemoteStore>[0]): RemoteStore {
  return new ObsRemoteStore(cfg);
}

function newSyncdStore(cfg: ConstructorParameters<typeof SyncdRemoteStore>[0]): RemoteStore {
  return new SyncdRemoteStore(cfg);
}

export interface SyncContext {
  vault: VaultConfig;
  remote: RemoteStore;
}

/** vault 就绪检查：未配置 → null；配置了但环境变量缺失 → 抛错（诚实失败）。 */
export function syncContext(store: CairnStore): SyncContext | null {
  const vault = loadVaultConfig(store.paths.dataDir);
  if (!vault) return null;
  return { vault, remote: buildRemoteStore(vault) };
}

/** 注册 worker 的真实上行 handler（configured 时调用；未配置保持诚实失败 handler）。 */
export function registerSyncWorker(store: CairnStore, remote: RemoteStore, vault: VaultConfig): void {
  registerHandler('sync_upstream', (job) => {
    // worker 已 claim 单个任务；push 以该任务触发批量发布（幂等：已推送修订跳过）
    void syncPush(store, remote, vault, { preclaimedJobs: [{ id: job.id, entityId: job.entityId, payload: job.payload }] });
  });
  // 迁出通知任务走同一条 push 链（add-scope-migration）：生成 scope_exit 控制事件。
  registerHandler('sync_scope_exit', (job) => {
    void syncPush(store, remote, vault, { preclaimedJobs: [{ id: job.id, entityId: job.entityId, payload: job.payload }] });
  });
}

/** 初始化远端：生成/复用密钥 + 写 vault.json + 确保 personal-global 为 encrypted。 */
export function initRemote(store: CairnStore, input: { provider: 'obs' | 'syncd'; obs?: { endpoint: string; bucket: string; prefix: string }; syncd?: { baseUrl: string } }): { vault: VaultConfig; recovery: string } {
  store.assertWritable();
  // 同步前提：personal-global 必须是 encrypted（默认预设即如此；被改过则明确失败）
  const scope = store.scopes.resolvePreset('personal-global');
  if (scope.syncPolicy !== 'encrypted') {
    throw err('E_VALIDATION', 'personal-global 作用域不是 encrypted，无法启用云同步');
  }
  const existingKeys = loadKeys(store.paths.dataDir);
  let keys: VaultKeys;
  if (existingKeys) {
    keys = existingKeys;
  } else {
    keys = generateVaultKeys();
    saveKeys(store.paths.dataDir, keys);
  }
  // vault 前缀并入 store prefix（OBS store 的 space/device 必须是单路径段）
  const obs = input.obs ? { endpoint: input.obs.endpoint, bucket: input.obs.bucket, prefix: `${input.obs.prefix}vaults/${keys.vaultId}/` } : undefined;
  const vault = saveVaultConfig(store.paths.dataDir, { provider: input.provider, obs, syncd: input.syncd, vaultId: keys.vaultId });
  store.audit.record('sync', 'remote_initialized', { type: 'system', id: vault.vaultId }, { provider: vault.provider });
  return { vault, recovery: exportRecoveryMaterial(keys) };
}

export { syncPush, syncPull, exportRecoveryMaterial, PERSONAL_SPACE_KEY };
