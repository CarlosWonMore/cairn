import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { err } from '../core/errors.js';
import { uuidv7 } from '../core/ids.js';
import { nowIso } from '../core/time.js';

/**
 * Vault 远端配置（design D1/D3）：dataDir/vault.json。
 * 凭据【绝不】写入本文件——OBS 走环境变量，syncd token 走环境变量。
 * 删除该文件即回到纯本地行为。
 */

export type SyncProvider = 'obs' | 'syncd';

export interface VaultConfig {
  vaultId: string;
  provider: SyncProvider;
  /** OBS: endpoint/bucket/prefix；syncd: baseUrl。凭据均走环境变量。 */
  obs?: { endpoint: string; bucket: string; prefix: string };
  syncd?: { baseUrl: string };
  createdAt: string;
}

export function vaultConfigPath(dataDir: string): string {
  return join(dataDir, 'vault.json');
}

export function loadVaultConfig(dataDir: string): VaultConfig | null {
  const p = vaultConfigPath(dataDir);
  if (!existsSync(p)) return null;
  try {
    const cfg = JSON.parse(readFileSync(p, 'utf8')) as VaultConfig;
    if (cfg.provider !== 'obs' && cfg.provider !== 'syncd') return null;
    return cfg;
  } catch {
    return null;
  }
}

export function saveVaultConfig(dataDir: string, cfg: Omit<VaultConfig, 'createdAt' | 'vaultId'> & { vaultId?: string }): VaultConfig {
  if (cfg.provider === 'obs' && !cfg.obs) throw err('E_VALIDATION', 'obs provider 需要 obs 配置');
  if (cfg.provider === 'syncd' && !cfg.syncd) throw err('E_VALIDATION', 'syncd provider 需要 syncd 配置');
  const existing = loadVaultConfig(dataDir);
  if (existing) throw err('E_IO', 'vault.json 已存在；如需重新配置请先删除该文件（远端对象可保留）');
  const full: VaultConfig = {
    vaultId: cfg.vaultId ?? `vlt_${uuidv7()}`,
    provider: cfg.provider,
    obs: cfg.obs,
    syncd: cfg.syncd,
    createdAt: nowIso(),
  };
  writeFileSync(vaultConfigPath(dataDir), JSON.stringify(full, null, 2), 'utf8');
  return full;
}

/**
 * 环境变量名约定（与 GITHUB_TOKEN 同模式，用户级注入）：
 * OBS: OBS_ACCESS_KEY_ID / OBS_SECRET_ACCESS_KEY（+ vault.json 的 endpoint/bucket/prefix）
 * syncd: CAIRN_SYNCD_TOKEN
 */
export const ENV = {
  obsAk: 'OBS_ACCESS_KEY_ID',
  obsSk: 'OBS_SECRET_ACCESS_KEY',
  syncdToken: 'CAIRN_SYNCD_TOKEN',
} as const;

/** 本变更首版同步的个人空间键（跨设备稳定标识；项目/自定义空间同步属后续边界）。 */
export const PERSONAL_SPACE_KEY = 'personal-global';
