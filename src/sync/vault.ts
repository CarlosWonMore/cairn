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
  /**
   * 保管模式（add-cloud-preserve-mode D1，vault 级开关，缺省 false）：
   * 关闭 = 既有物理排除语义（设备限定/项目内容不上云）；
   * 开启 = 它们以密文上行到本设备的保管链（preserve/<deviceId>）。
   * 无论何种模式，agent-private 与 session-ephemeral 永不上云。
   */
  preserveDeviceBound?: boolean;
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
    ...(cfg.preserveDeviceBound ? { preserveDeviceBound: true } : {}),
    createdAt: nowIso(),
  };
  writeFileSync(vaultConfigPath(dataDir), JSON.stringify(full, null, 2), 'utf8');
  return full;
}

/** 已有配置的原地修改（vault config 子命令）：保留身份与远端段，只改指定开关。 */
export function updateVaultConfig(dataDir: string, patch: { preserveDeviceBound: boolean }): VaultConfig {
  const cfg = loadVaultConfig(dataDir);
  if (!cfg) throw err('E_VALIDATION', 'vault.json 不存在；先 cairn vault init-remote');
  const next: VaultConfig = { ...cfg, preserveDeviceBound: patch.preserveDeviceBound };
  if (!patch.preserveDeviceBound) delete next.preserveDeviceBound; // 缺省 false：键不落盘，与未配置过一致
  writeFileSync(vaultConfigPath(dataDir), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

/** 保管模式是否开启（缺省关闭；未配置远端时恒关闭）。 */
export function preserveModeEnabled(dataDir: string): boolean {
  return loadVaultConfig(dataDir)?.preserveDeviceBound === true;
}

/**
 * 环境变量名约定（与 GITHUB_TOKEN 同模式，用户级注入）：
 * OBS: OBS_ACCESS_KEY_ID / OBS_SECRET_ACCESS_KEY（+ vault.json 的 endpoint/bucket/prefix）
 * syncd: CAIRN_SYNCD_TOKEN（凭据）；CAIRN_SYNCD_URL（baseUrl 缺省值，命令行 --base-url 优先）
 */
export const ENV = {
  obsAk: 'OBS_ACCESS_KEY_ID',
  obsSk: 'OBS_SECRET_ACCESS_KEY',
  syncdToken: 'CAIRN_SYNCD_TOKEN',
  syncdUrl: 'CAIRN_SYNCD_URL',
} as const;

/** 本变更首版同步的个人空间键（跨设备稳定标识；历史键名不改名——design D6）。 */
export const PERSONAL_SPACE_KEY = 'personal-global';

/** 保管链前缀（design D2）：每设备一条，`preserve/<deviceId>`，只有本设备拉取。 */
export const PRESERVE_CHAIN_PREFIX = 'preserve/';

/** 本设备的保管链空间键。 */
export function preserveSpaceKey(deviceId: string): string {
  return `${PRESERVE_CHAIN_PREFIX}${deviceId}`;
}

export function isPreserveSpaceKey(spaceKey: string): boolean {
  return spaceKey.startsWith(PRESERVE_CHAIN_PREFIX);
}

/**
 * 项目链前缀（add-cross-device-project-sync D1）：一个项目一条链，`project/<projectId>`。
 * projectId 是跨设备稳定 UUID；所有设备都列举并拉取（与保管链相反）。
 */
export const PROJECT_CHAIN_PREFIX = 'project/';

export function projectSpaceKey(projectId: string): string {
  return `${PROJECT_CHAIN_PREFIX}${projectId}`;
}

export function isProjectSpaceKey(spaceKey: string): boolean {
  return spaceKey.startsWith(PROJECT_CHAIN_PREFIX);
}

/** 反解项目链的空间键；非项目链或空 id 返回 null（不猜、不抛）。 */
export function projectIdFromSpaceKey(spaceKey: string): string | null {
  if (!isProjectSpaceKey(spaceKey)) return null;
  const id = spaceKey.slice(PROJECT_CHAIN_PREFIX.length);
  return id.length > 0 ? id : null;
}

/** 保管链承载的作用域预设（spec「保管链与物化过滤」：设备限定与项目内容）。 */
export const PRESERVE_SCOPE_PRESETS = ['device-local', 'project-global', 'project-device'] as const;

export function isPreserveScopePreset(preset: string): boolean {
  return (PRESERVE_SCOPE_PRESETS as readonly string[]).includes(preset);
}

/**
 * 本设备会消费的链（tasks 1.3）：个人链恒在；项目链按调用方传入的列表展开
 * （本函数不读 DB、不触网——发现与登记是调用方的事）；保管模式开启时加本设备保管链。
 * pull 范围 = 这条列表——他人保管链对象完全不被下载（D2）。
 */
export function syncableChains(vault: VaultConfig, deviceId: string, projectIds: readonly string[] = []): string[] {
  const chains = [PERSONAL_SPACE_KEY];
  for (const projectId of projectIds) {
    if (projectId) chains.push(projectSpaceKey(projectId));
  }
  if (vault.preserveDeviceBound === true) chains.push(preserveSpaceKey(deviceId));
  return chains;
}
