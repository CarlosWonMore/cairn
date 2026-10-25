/**
 * Cairn 云同步 E2EE 工具（design D3 / spec「加密中继与密钥主权」）。
 *
 * 密文线格式（版本化；禁止自造算法，全部使用可审计纯 JS 库 @noble/ciphers、@noble/hashes）：
 *
 *   [version(1B)] [nonce(24B)] [XChaCha20-Poly1305 ciphertext || Poly1305 tag(16B)]
 *
 * - version 即 CIPHER_VERSION（当前 1）；不匹配 → E_VALIDATION 'cipher_version_mismatch'。
 * - nonce 每次加密用 CSPRNG 随机生成 24B（XChaCha 扩展 nonce，随机 nonce 安全）。
 * - AAD = UTF8(`v1|${vaultId}|${spaceId}|${kind}|${objectId}`)，把每段密文绑定到
 *   vault/space/kind/object：任一字段不匹配 → Poly1305 校验失败 →
 *   E_VALIDATION 'auth_tag_invalid'（密文不能被搬到别的 chunk/manifest 位置）。
 * - space 数据密钥 = HKDF-SHA256(vaultKey, salt='cairn-space-key', info=`v1|${spaceId}`)：
 *   vault 主密钥不直接加密任何数据，泄露面按 space 隔离（tests 有字面量锚定测试）。
 *
 * 信任边界（诚实声明，构想 §12.2）：
 * - keys.json 中的 vaultKey 是本地明文，与 SQLite 数据库文件处于同等信任边界；
 *   文件权限只防误读，不防拿到磁盘的人；设备级保护依赖磁盘加密与账户隔离。
 * - 恢复材料（CAIRN1.…）同样是密钥明文的编码形态，抄写保存，丢失即远端不可恢复。
 * - 所有错误信息为稳定短语，绝不包含密钥字节（hex/base64）或记忆内容。
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { err } from '../core/errors.js';
import { canonicalJson } from '../core/hash.js';
import { isUuid, uuidv7 } from '../core/ids.js';
import { nowIso } from '../core/time.js';

/** 密文格式版本号（线格式首字节）。未来算法更换/密钥轮换时递增并引入 keyId（design D3）。 */
export const CIPHER_VERSION = 1;

const VERSION_LEN = 1;
/** XChaCha20 扩展 nonce 长度。 */
const NONCE_LEN = 24;
/** Poly1305 认证标签长度。 */
const TAG_LEN = 16;
/** vaultKey / spaceKey 均为 32 字节。 */
const KEY_LEN = 32;
/** 最小合法密文长度：版本(1) + nonce(24) + 空 plaintext 的 tag(16)。 */
const MIN_BLOB_LEN = VERSION_LEN + NONCE_LEN + TAG_LEN;

/** HKDF salt 固定串。info 携带协议版本与 spaceId；tests/sync 有字面量锚定测试防止无意变更。 */
const SPACE_KEY_SALT = 'cairn-space-key';

const KEYS_FILE = 'keys.json';
const KEYS_FORMAT = 'cairn-vault-keys';
const KEYS_VERSION = 1;

/** 恢复材料前缀（CAIRN1.<base64url(canonicalJson)>）。 */
const RECOVERY_PREFIX = 'CAIRN1.';
const RECOVERY_FORMAT = 'cairn-vault-recovery';
const RECOVERY_VERSION = 1;

const textEncoder = new TextEncoder();

/** AAD 对象类型：chunk（一批同步事件）或 manifest（设备 manifest）。 */
export type EncryptedObjectKind = 'chunk' | 'manifest';

/**
 * AAD 绑定字段：协议版本、vault、space、对象类型与对象 ID 全部入册
 * （spec：认证加密 AAD 绑定协议版本、vault、space、对象标识）。
 */
export interface CipherAad {
  vaultId: string;
  spaceId: string;
  kind: EncryptedObjectKind;
  objectId: string;
}

/** vault 密钥集：本地持有、不上传明文（MUST NOT 上传密钥明文）。 */
export interface VaultKeys {
  vaultId: string;
  /** 32 字节 vault 主密钥；本地明文保存（与 SQLite 同等信任边界，见文件头注释）。 */
  vaultKey: Uint8Array;
  createdAt: string;
}

/** 生成新 vault 密钥集：vaultId 为 UUIDv7（时间可排序），vaultKey 为 32B CSPRNG 随机。 */
export function generateVaultKeys(): VaultKeys {
  // Uint8Array.from 复制一份，脱离 Buffer 内部池化语义，保证返回纯 Uint8Array。
  return {
    vaultId: uuidv7(),
    vaultKey: Uint8Array.from(randomBytes(KEY_LEN)),
    createdAt: nowIso(),
  };
}

/**
 * 派生 space 数据密钥：HKDF-SHA256(vaultKey, salt='cairn-space-key', info=`v1|${spaceId}`)。
 * 确定性：同 vaultKey + 同 spaceId 永远得到同一 spaceKey（跨设备无需协商）。
 */
export function deriveSpaceKey(vaultKey: Uint8Array, spaceId: string): Uint8Array {
  if (!(vaultKey instanceof Uint8Array) || vaultKey.length !== KEY_LEN) {
    throw err('E_VALIDATION', 'vault_key_invalid_length', {
      expected: KEY_LEN,
      got: vaultKey instanceof Uint8Array ? vaultKey.length : null,
    });
  }
  if (typeof spaceId !== 'string' || spaceId.length === 0) {
    throw err('E_VALIDATION', 'space_id_invalid');
  }
  return hkdf(sha256, vaultKey, textEncoder.encode(SPACE_KEY_SALT), textEncoder.encode(`v1|${spaceId}`), KEY_LEN);
}

/**
 * 加密一个同步对象。输出 = [versionByte(1)] + [nonce(24)] + [ciphertext+tag]。
 * AAD = UTF8(`v1|${vaultId}|${spaceId}|${kind}|${objectId}`)。
 */
export function encryptObject(plaintext: Uint8Array, spaceKey: Uint8Array, aad: CipherAad): Uint8Array {
  assertAad(aad);
  assertSpaceKey(spaceKey);
  if (!(plaintext instanceof Uint8Array)) {
    throw err('E_VALIDATION', 'plaintext_invalid');
  }
  const nonce = randomBytes(NONCE_LEN);
  const ciphertext = xchacha20poly1305(spaceKey, nonce, aadBytes(aad)).encrypt(plaintext);
  const out = new Uint8Array(VERSION_LEN + NONCE_LEN + ciphertext.length);
  out[0] = CIPHER_VERSION;
  out.set(nonce, VERSION_LEN);
  out.set(ciphertext, VERSION_LEN + NONCE_LEN);
  return out;
}

/**
 * 解密一个同步对象。
 * - 版本字节不匹配 → E_VALIDATION 'cipher_version_mismatch'；
 * - blob 过短 → E_VALIDATION 'cipher_blob_too_short'；
 * - tag 校验失败或 AAD 不匹配 → E_VALIDATION 'auth_tag_invalid'。
 */
export function decryptObject(blob: Uint8Array, spaceKey: Uint8Array, aad: CipherAad): Uint8Array {
  assertAad(aad);
  assertSpaceKey(spaceKey);
  if (!(blob instanceof Uint8Array) || blob.length < MIN_BLOB_LEN) {
    throw err('E_VALIDATION', 'cipher_blob_too_short', {
      got: blob instanceof Uint8Array ? blob.length : null,
      minLength: MIN_BLOB_LEN,
    });
  }
  const version = blob[0];
  if (version !== CIPHER_VERSION) {
    throw err('E_VALIDATION', 'cipher_version_mismatch', { got: version, expected: CIPHER_VERSION });
  }
  const nonce = blob.subarray(VERSION_LEN, VERSION_LEN + NONCE_LEN);
  const ciphertext = blob.subarray(VERSION_LEN + NONCE_LEN);
  try {
    return xchacha20poly1305(spaceKey, nonce, aadBytes(aad)).decrypt(ciphertext);
  } catch {
    // noble 对 tag 不匹配 / AAD 不匹配 / 密钥错误统一抛 'invalid tag'；
    // 对外只暴露稳定错误短语，不透传内部细节（也不含密钥材质）。
    throw err('E_VALIDATION', 'auth_tag_invalid');
  }
}

/**
 * 保存 vault 密钥到 `dataDir/keys.json`。
 *
 * - 已存在时拒绝覆盖（E_IO 'keys_already_exist'）：防止误覆盖丢密钥；
 *   写入用 flag 'wx'（已存在即失败的原子语义，覆盖并发窗口）。
 * - POSIX：显式 chmod 0600（'wx' 新建 + mode 0600 下 umask 只能再去位，结果仍为 0600，chmod 为兜底）。
 * - Windows 局限（诚实边界，构想 §12.2）：Node 的 fs.chmodSync 在 Windows 上只能切换
 *   只读位，不对应 POSIX 0600；NTFS ACL 无法用 POSIX 模式表达，因此 Windows 下不做 chmod。
 *   keys.json 的 vaultKey 是本地明文，与 SQLite 库文件同等信任边界：文件权限不等于加密，
 *   设备级保护依赖磁盘加密（BitLocker）与账户隔离，而非这里的文件模式。
 */
export function saveKeys(dataDir: string, keys: VaultKeys): void {
  if (typeof dataDir !== 'string' || dataDir.length === 0) {
    throw err('E_VALIDATION', 'data_dir_invalid');
  }
  assertVaultKeys(keys);
  mkdirSync(dataDir, { recursive: true });
  const path = join(dataDir, KEYS_FILE);
  if (existsSync(path)) {
    throw err('E_IO', 'keys_already_exist', { path });
  }
  const body = canonicalJson({
    createdAt: keys.createdAt,
    format: KEYS_FORMAT,
    vaultId: keys.vaultId,
    vaultKey: toBase64(keys.vaultKey),
    version: KEYS_VERSION,
  });
  try {
    writeFileSync(path, body + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException | null)?.code;
    if (code === 'EEXIST') {
      throw err('E_IO', 'keys_already_exist', { path });
    }
    throw err('E_IO', 'keys_write_failed', { path, cause: code ?? null });
  }
  if (process.platform !== 'win32') {
    chmodSync(path, 0o600);
  }
}

/**
 * 读取 vault 密钥。目录/文件不存在、JSON 损坏、字段缺失或密钥长度不符 → null
 * （调用方按「缺少 vault 密钥」路径处理，如提示导出过的恢复材料）。
 */
export function loadKeys(dataDir: string): VaultKeys | null {
  const path = join(dataDir, KEYS_FILE);
  if (!existsSync(path)) {
    return null;
  }
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }
  if (obj === null || typeof obj !== 'object') {
    return null;
  }
  const rec = obj as Record<string, unknown>;
  if (rec['format'] !== KEYS_FORMAT || rec['version'] !== KEYS_VERSION) {
    return null;
  }
  const vaultId = rec['vaultId'];
  const vaultKey = rec['vaultKey'];
  const createdAt = rec['createdAt'];
  if (typeof vaultId !== 'string' || !isUuid(vaultId)) {
    return null;
  }
  if (typeof vaultKey !== 'string' || typeof createdAt !== 'string') {
    return null;
  }
  const keyBytes = decodeBase64Key(vaultKey);
  if (keyBytes === null || Number.isNaN(Date.parse(createdAt))) {
    return null;
  }
  return { vaultId, vaultKey: keyBytes, createdAt };
}

/**
 * 导出人类可抄写的恢复材料：`CAIRN1.<base64url(canonicalJson)>`，
 * 规范化 JSON 内含 { createdAt, format, vaultId, vaultKey(base64), version }。
 * 这是密钥明文的编码形态——抄写保存，丢失即远端不可恢复（spec：密钥丢失场景）。
 */
export function exportRecoveryMaterial(keys: VaultKeys): string {
  assertVaultKeys(keys);
  const body = canonicalJson({
    createdAt: keys.createdAt,
    format: RECOVERY_FORMAT,
    vaultId: keys.vaultId,
    vaultKey: toBase64(keys.vaultKey),
    version: RECOVERY_VERSION,
  });
  return RECOVERY_PREFIX + Buffer.from(body, 'utf8').toString('base64url');
}

/** 恢复材料的逆操作；前缀/编码/字段完整性任一不合法 → E_VALIDATION 'recovery_material_invalid'。 */
export function importRecoveryMaterial(text: string): VaultKeys {
  if (typeof text !== 'string') {
    throwRecoveryInvalid();
  }
  const trimmed = text.trim();
  if (!trimmed.startsWith(RECOVERY_PREFIX)) {
    throwRecoveryInvalid();
  }
  const payload = trimmed.slice(RECOVERY_PREFIX.length);
  // base64url 字符集严格校验（Buffer 的 base64 解码是宽容的，需自行把关）。
  if (!/^[A-Za-z0-9_-]+$/.test(payload)) {
    throwRecoveryInvalid();
  }
  let body: string;
  try {
    body = Buffer.from(payload, 'base64url').toString('utf8');
  } catch {
    throwRecoveryInvalid();
  }
  let obj: unknown;
  try {
    obj = JSON.parse(body);
  } catch {
    throwRecoveryInvalid();
  }
  if (obj === null || typeof obj !== 'object') {
    throwRecoveryInvalid();
  }
  const rec = obj as Record<string, unknown>;
  if (rec['format'] !== RECOVERY_FORMAT || rec['version'] !== RECOVERY_VERSION) {
    throwRecoveryInvalid();
  }
  const vaultId = rec['vaultId'];
  const vaultKey = rec['vaultKey'];
  const createdAt = rec['createdAt'];
  if (typeof vaultId !== 'string' || !isUuid(vaultId)) {
    throwRecoveryInvalid();
  }
  if (typeof vaultKey !== 'string' || typeof createdAt !== 'string') {
    throwRecoveryInvalid();
  }
  const keyBytes = decodeBase64Key(vaultKey);
  if (keyBytes === null || Number.isNaN(Date.parse(createdAt))) {
    throwRecoveryInvalid();
  }
  return { vaultId, vaultKey: keyBytes, createdAt };
}

// ---------------------------------------------------------------------------
// 内部辅助
// ---------------------------------------------------------------------------

function assertAad(aad: CipherAad): void {
  if (
    aad === null ||
    typeof aad !== 'object' ||
    typeof aad.vaultId !== 'string' ||
    aad.vaultId.length === 0 ||
    typeof aad.spaceId !== 'string' ||
    aad.spaceId.length === 0 ||
    typeof aad.objectId !== 'string' ||
    aad.objectId.length === 0 ||
    (aad.kind !== 'chunk' && aad.kind !== 'manifest')
  ) {
    throw err('E_VALIDATION', 'aad_invalid');
  }
}

function assertSpaceKey(spaceKey: Uint8Array): void {
  if (!(spaceKey instanceof Uint8Array) || spaceKey.length !== KEY_LEN) {
    throw err('E_VALIDATION', 'space_key_invalid_length', {
      expected: KEY_LEN,
      got: spaceKey instanceof Uint8Array ? spaceKey.length : null,
    });
  }
}

function assertVaultKeys(keys: VaultKeys): void {
  if (
    keys === null ||
    typeof keys !== 'object' ||
    typeof keys.vaultId !== 'string' ||
    !isUuid(keys.vaultId) ||
    !(keys.vaultKey instanceof Uint8Array) ||
    keys.vaultKey.length !== KEY_LEN ||
    typeof keys.createdAt !== 'string' ||
    Number.isNaN(Date.parse(keys.createdAt))
  ) {
    throw err('E_VALIDATION', 'vault_keys_invalid');
  }
}

function aadBytes(aad: CipherAad): Uint8Array {
  return textEncoder.encode(`v1|${aad.vaultId}|${aad.spaceId}|${aad.kind}|${aad.objectId}`);
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/**
 * 解码 keys.json / 恢复材料中的 vaultKey（标准 base64，32 字节）。
 * 宽容缺省 padding；长度不符或编码非规范化形态 → null。
 */
function decodeBase64Key(s: string): Uint8Array | null {
  const raw = Buffer.from(s, 'base64');
  if (raw.length !== KEY_LEN) {
    return null;
  }
  const canonical = raw.toString('base64');
  if (s !== canonical && s !== canonical.replace(/=+$/, '')) {
    return null;
  }
  return Uint8Array.from(raw);
}

function throwRecoveryInvalid(): never {
  throw err('E_VALIDATION', 'recovery_material_invalid');
}
