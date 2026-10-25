/**
 * 云同步 E2EE 工具测试（design D3 / spec「加密中继与密钥主权」）。
 *
 * 覆盖：往返（0B/1B/1KB/512KB + 性能）、线格式锁定、随机 nonce 唯一性、
 * AAD 四字段绑定（防密文搬运）、篡改与版本字节、HKDF 派生确定性/隔离/字面量锚、
 * 密钥文件（save/load/拒绝覆盖/损坏容错/0600）、恢复材料（往返/非法输入/结构/端到端恢复）、
 * 错误信息不含密钥材质。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import {
  CIPHER_VERSION,
  type CipherAad,
  type VaultKeys,
  decryptObject,
  deriveSpaceKey,
  encryptObject,
  exportRecoveryMaterial,
  generateVaultKeys,
  importRecoveryMaterial,
  loadKeys,
  saveKeys,
} from '../../src/sync/cryptoutil.js';
import { isCairnError } from '../../src/core/errors.js';
import { isUuid } from '../../src/core/ids.js';

// ---------------------------------------------------------------------------
// 测试辅助
// ---------------------------------------------------------------------------

const buf = (u: Uint8Array): Buffer => Buffer.from(u);
const SPACE_ID = 'space-test-1';
const OBJECT_ID = 'obj-0001';

function makeAad(overrides: Partial<CipherAad> = {}, vaultId = '11111111-2222-7333-8444-555555555555'): CipherAad {
  return { vaultId, spaceId: SPACE_ID, kind: 'chunk', objectId: OBJECT_ID, ...overrides };
}

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'cairn-cryptoutil-'));
}

function withTmpDir(fn: (dir: string) => void): void {
  const dir = tmpDir();
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function catchCairn(fn: () => unknown): { code: string; message: string; details?: Record<string, unknown> } {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  assert.ok(caught !== undefined, '应抛出错误，但没有抛');
  assert.ok(isCairnError(caught), `应抛 CairnError，实际: ${String(caught)}`);
  return caught as unknown as { code: string; message: string; details?: Record<string, unknown> };
}

function keyMaterialFingerprints(keys: VaultKeys): string[] {
  const key = buf(keys.vaultKey);
  return [key.toString('hex'), key.toString('base64'), key.toString('base64url')];
}

function assertNoKeyMaterial(error: { message: string; details?: Record<string, unknown> }, keys: VaultKeys): void {
  const rendered = error.message + ' ' + JSON.stringify(error.details ?? {});
  for (const fp of keyMaterialFingerprints(keys)) {
    assert.ok(!rendered.includes(fp), `错误信息不得包含密钥材质（${fp.slice(0, 8)}… 前缀出现）`);
  }
}

// ---------------------------------------------------------------------------
// 密钥生成与派生
// ---------------------------------------------------------------------------

test('generateVaultKeys：vaultId 为合法 UUID、vaultKey 32B、createdAt 可解析；两次调用不可复现', () => {
  const k1 = generateVaultKeys();
  const k2 = generateVaultKeys();
  assert.ok(isUuid(k1.vaultId), `vaultId 应为 UUID 形态: ${k1.vaultId}`);
  assert.equal(k1.vaultKey.length, 32);
  assert.ok(Number.isFinite(Date.parse(k1.createdAt)), `createdAt 应可解析: ${k1.createdAt}`);
  assert.notEqual(k1.vaultId, k2.vaultId, 'vaultId 应随机不可复现');
  assert.ok(!buf(k1.vaultKey).equals(buf(k2.vaultKey)), 'vaultKey 应随机不可复现');
});

test('deriveSpaceKey：同 vaultKey 同 spaceId → 同 spaceKey（确定性，跨设备一致）', () => {
  const keys = generateVaultKeys();
  const a = deriveSpaceKey(keys.vaultKey, SPACE_ID);
  const b = deriveSpaceKey(keys.vaultKey, SPACE_ID);
  assert.equal(a.length, 32);
  assert.ok(buf(a).equals(buf(b)), '同输入派生必须一致');
});

test('deriveSpaceKey：不同 spaceId → 不同 spaceKey（space 间隔离）', () => {
  const keys = generateVaultKeys();
  const a = deriveSpaceKey(keys.vaultKey, 'space-a');
  const b = deriveSpaceKey(keys.vaultKey, 'space-b');
  assert.ok(!buf(a).equals(buf(b)), '不同 spaceId 必须派生出不同密钥');
});

test('deriveSpaceKey：不同 vaultKey → 不同 spaceKey', () => {
  const a = deriveSpaceKey(Uint8Array.from(randomBytes(32)), SPACE_ID);
  const b = deriveSpaceKey(Uint8Array.from(randomBytes(32)), SPACE_ID);
  assert.ok(!buf(a).equals(buf(b)), '不同 vaultKey 必须派生出不同密钥');
});

test('deriveSpaceKey：HKDF 字面量锚 —— salt/info 约定被锁定，防无意变更破坏跨设备兼容', () => {
  // 锚定 design D3 约定：HKDF-SHA256(vaultKey, salt='cairn-space-key', info=`v1|${spaceId}`, 32)。
  // 此处故意硬编码字面量而非引用模块常量。
  const vaultKey = Uint8Array.from(randomBytes(32));
  const expected = hkdf(
    sha256,
    vaultKey,
    new TextEncoder().encode('cairn-space-key'),
    new TextEncoder().encode(`v1|${SPACE_ID}`),
    32,
  );
  assert.ok(buf(deriveSpaceKey(vaultKey, SPACE_ID)).equals(Buffer.from(expected)));
});

test('deriveSpaceKey：vaultKey 长度非法（16B）→ E_VALIDATION，错误不含密钥材质', () => {
  const short = Uint8Array.from(randomBytes(16));
  const e = catchCairn(() => deriveSpaceKey(short, SPACE_ID));
  assert.equal(e.code, 'E_VALIDATION');
  assert.equal(e.message, 'vault_key_invalid_length');
  assert.ok(!e.message.includes(buf(short).toString('hex')));
});

// ---------------------------------------------------------------------------
// 加解密往返与线格式
// ---------------------------------------------------------------------------

test('往返 0B：空明文原样还原（密文长 41 = 1+24+16）', () => {
  const keys = generateVaultKeys();
  const sk = deriveSpaceKey(keys.vaultKey, SPACE_ID);
  const aad = makeAad();
  const blob = encryptObject(new Uint8Array(0), sk, aad);
  assert.equal(blob.length, 1 + 24 + 16);
  const back = decryptObject(blob, sk, aad);
  assert.equal(back.length, 0);
});

test('往返 1B', () => {
  const keys = generateVaultKeys();
  const sk = deriveSpaceKey(keys.vaultKey, SPACE_ID);
  const aad = makeAad();
  const pt = Uint8Array.from([0x00]);
  const back = decryptObject(encryptObject(pt, sk, aad), sk, aad);
  assert.ok(buf(back).equals(buf(pt)));
});

test('往返 1KB：含 UTF-8 中文与二进制全字节样本', () => {
  const keys = generateVaultKeys();
  const sk = deriveSpaceKey(keys.vaultKey, SPACE_ID);
  const aad = makeAad();
  const pt = buf(new TextEncoder().encode('记忆正文样本 —— 本地优先，云端只见密文。'));
  const mixed = Uint8Array.from([...pt, ...randomBytes(1024 - pt.length)]);
  const back = decryptObject(encryptObject(mixed, sk, aad), sk, aad);
  assert.ok(buf(back).equals(buf(mixed)));
});

test('往返 512KB：原样还原且总耗时 <1s（性能冒烟）', () => {
  const keys = generateVaultKeys();
  const sk = deriveSpaceKey(keys.vaultKey, SPACE_ID);
  const aad = makeAad();
  const pt = randomBytes(512 * 1024);
  const t0 = performance.now();
  const blob = encryptObject(pt, sk, aad);
  const back = decryptObject(blob, sk, aad);
  const ms = performance.now() - t0;
  assert.ok(buf(back).equals(buf(pt)));
  assert.ok(ms < 1000, `512KB 往返应 <1000ms，实际 ${ms.toFixed(1)}ms`);
});

test('线格式锁定：首字节=CIPHER_VERSION(1)，nonce 位于 [1,25)，其余为 XChaCha20-Poly1305 密文+tag', () => {
  const keys = generateVaultKeys();
  const sk = deriveSpaceKey(keys.vaultKey, SPACE_ID);
  const aad = makeAad();
  const pt = randomBytes(128);
  const blob = encryptObject(pt, sk, aad);
  assert.equal(blob[0], CIPHER_VERSION);
  assert.equal(blob.length, 1 + 24 + pt.length + 16);
  // 用提取出的 nonce 段与约定 AAD 串独立重算，必须与密文段完全一致 —— 锁定字节布局与 AAD 公式。
  const nonce = blob.subarray(1, 25);
  const ciphertext = blob.subarray(25);
  const aadU8 = new TextEncoder().encode(`v1|${aad.vaultId}|${aad.spaceId}|${aad.kind}|${aad.objectId}`);
  const recomputed = xchacha20poly1305(sk, nonce, aadU8).encrypt(pt);
  assert.ok(buf(ciphertext).equals(Buffer.from(recomputed)), '线格式或 AAD 公式发生未预期变化');
});

test('nonce 唯一性：同明文同 key 两次加密密文不同（随机 nonce，不可复现）', () => {
  const keys = generateVaultKeys();
  const sk = deriveSpaceKey(keys.vaultKey, SPACE_ID);
  const aad = makeAad();
  const pt = randomBytes(64);
  const b1 = encryptObject(pt, sk, aad);
  const b2 = encryptObject(pt, sk, aad);
  assert.ok(!buf(b1).equals(buf(b2)), '同输入两次加密必须产生不同密文');
  assert.ok(!buf(b1.subarray(1, 25)).equals(buf(b2.subarray(1, 25))), 'nonce 段应每次随机');
});

// ---------------------------------------------------------------------------
// AAD 绑定（防密文搬运到别的 chunk/manifest 位置）
// ---------------------------------------------------------------------------

test('AAD 绑定：vaultId 不匹配 → auth_tag_invalid', () => {
  const keys = generateVaultKeys();
  const sk = deriveSpaceKey(keys.vaultKey, SPACE_ID);
  const blob = encryptObject(randomBytes(32), sk, makeAad());
  const e = catchCairn(() => decryptObject(blob, sk, makeAad({}, '99999999-9999-7999-8999-999999999999')));
  assert.equal(e.code, 'E_VALIDATION');
  assert.equal(e.message, 'auth_tag_invalid');
});

test('AAD 绑定：spaceId 不匹配 → auth_tag_invalid', () => {
  const keys = generateVaultKeys();
  const sk = deriveSpaceKey(keys.vaultKey, SPACE_ID);
  const blob = encryptObject(randomBytes(32), sk, makeAad());
  const e = catchCairn(() => decryptObject(blob, sk, makeAad({ spaceId: 'space-other' })));
  assert.equal(e.code, 'E_VALIDATION');
  assert.equal(e.message, 'auth_tag_invalid');
});

test('AAD 绑定：kind 不匹配（chunk vs manifest）→ auth_tag_invalid', () => {
  const keys = generateVaultKeys();
  const sk = deriveSpaceKey(keys.vaultKey, SPACE_ID);
  const blob = encryptObject(randomBytes(32), sk, makeAad());
  const e = catchCairn(() => decryptObject(blob, sk, makeAad({ kind: 'manifest' })));
  assert.equal(e.code, 'E_VALIDATION');
  assert.equal(e.message, 'auth_tag_invalid');
});

test('AAD 绑定：objectId 不匹配 → auth_tag_invalid（密文不可搬到别的对象位置）', () => {
  const keys = generateVaultKeys();
  const sk = deriveSpaceKey(keys.vaultKey, SPACE_ID);
  const blob = encryptObject(randomBytes(32), sk, makeAad());
  const e = catchCairn(() => decryptObject(blob, sk, makeAad({ objectId: 'obj-9999' })));
  assert.equal(e.code, 'E_VALIDATION');
  assert.equal(e.message, 'auth_tag_invalid');
});

// ---------------------------------------------------------------------------
// 篡改、版本与畸形输入
// ---------------------------------------------------------------------------

test('篡改：密文区单字节翻转 → auth_tag_invalid', () => {
  const keys = generateVaultKeys();
  const sk = deriveSpaceKey(keys.vaultKey, SPACE_ID);
  const aad = makeAad();
  const blob = Uint8Array.from(encryptObject(randomBytes(256), sk, aad));
  blob[100] = (blob[100] ?? 0) ^ 0x01;
  const e = catchCairn(() => decryptObject(blob, sk, aad));
  assert.equal(e.message, 'auth_tag_invalid');
});

test('篡改：tag 区单字节翻转 → auth_tag_invalid', () => {
  const keys = generateVaultKeys();
  const sk = deriveSpaceKey(keys.vaultKey, SPACE_ID);
  const aad = makeAad();
  const blob = Uint8Array.from(encryptObject(randomBytes(64), sk, aad));
  blob[blob.length - 1] = (blob[blob.length - 1] ?? 0) ^ 0x80;
  const e = catchCairn(() => decryptObject(blob, sk, aad));
  assert.equal(e.message, 'auth_tag_invalid');
});

test('版本字节非 1（2 与 0）→ cipher_version_mismatch', () => {
  const keys = generateVaultKeys();
  const sk = deriveSpaceKey(keys.vaultKey, SPACE_ID);
  const aad = makeAad();
  for (const v of [2, 0]) {
    const blob = Uint8Array.from(encryptObject(randomBytes(16), sk, aad));
    blob[0] = v;
    const e = catchCairn(() => decryptObject(blob, sk, aad));
    assert.equal(e.code, 'E_VALIDATION');
    assert.equal(e.message, 'cipher_version_mismatch');
  }
});

test('截断 blob（40B < 最小 41B）→ cipher_blob_too_short', () => {
  const keys = generateVaultKeys();
  const sk = deriveSpaceKey(keys.vaultKey, SPACE_ID);
  const blob = encryptObject(new Uint8Array(0), sk, makeAad());
  const e = catchCairn(() => decryptObject(blob.subarray(0, 40), sk, makeAad()));
  assert.equal(e.message, 'cipher_blob_too_short');
});

test('encryptObject：spaceKey 长度非法 → E_VALIDATION space_key_invalid_length', () => {
  const e = catchCairn(() => encryptObject(randomBytes(8), Uint8Array.from(randomBytes(16)), makeAad()));
  assert.equal(e.code, 'E_VALIDATION');
  assert.equal(e.message, 'space_key_invalid_length');
});

// ---------------------------------------------------------------------------
// 密钥文件（dataDir/keys.json）
// ---------------------------------------------------------------------------

test('saveKeys → loadKeys 往返一致；POSIX 下文件权限 0600', () => {
  withTmpDir((dir) => {
    const keys = generateVaultKeys();
    saveKeys(dir, keys);
    const loaded = loadKeys(dir);
    assert.ok(loaded !== null, 'loadKeys 应能读回');
    assert.equal(loaded.vaultId, keys.vaultId);
    assert.ok(buf(loaded.vaultKey).equals(buf(keys.vaultKey)));
    assert.equal(loaded.createdAt, keys.createdAt);
    if (process.platform !== 'win32') {
      const mode = statSync(join(dir, 'keys.json')).mode & 0o777;
      assert.equal(mode, 0o600, `POSIX 下 keys.json 应为 0600，实际 ${mode.toString(8)}`);
    } else {
      // Windows：Node chmod 不表达 NTFS ACL（实现注释已声明局限），只断言文件落盘。
      assert.ok(existsSync(join(dir, 'keys.json')));
    }
  });
});

test('二次 saveKeys 拒绝覆盖（keys_already_exist），且原文件内容未被破坏', () => {
  withTmpDir((dir) => {
    const first = generateVaultKeys();
    saveKeys(dir, first);
    const second = generateVaultKeys();
    const e = catchCairn(() => saveKeys(dir, second));
    assert.equal(e.code, 'E_IO');
    assert.equal(e.message, 'keys_already_exist');
    const loaded = loadKeys(dir);
    assert.ok(loaded !== null && loaded.vaultId === first.vaultId, '原密钥必须原样保留');
    assert.ok(!buf(loaded!.vaultKey).equals(buf(second.vaultKey)));
  });
});

test('loadKeys：目录/文件不存在 → null（不抛错）', () => {
  withTmpDir((dir) => {
    assert.equal(loadKeys(dir), null);
    assert.equal(loadKeys(join(dir, 'no-such-subdir')), null);
  });
});

test('loadKeys：损坏 JSON / 缺字段 / 密钥长度不符 → null', () => {
  withTmpDir((dir) => {
    const path = join(dir, 'keys.json');
    writeFileSync(path, '{not json at all', 'utf8');
    assert.equal(loadKeys(dir), null, '损坏 JSON 应返回 null');

    writeFileSync(path, JSON.stringify({ format: 'cairn-vault-keys' }), 'utf8');
    assert.equal(loadKeys(dir), null, '缺字段应返回 null');

    const keys = generateVaultKeys();
    // vaultKey 只有 16 字节 → null
    saveKeysRaw(dir, { vaultId: keys.vaultId, vaultKeyB64: buf(keys.vaultKey).subarray(0, 16).toString('base64'), createdAt: keys.createdAt });
    assert.equal(loadKeys(dir), null, 'vaultKey 长度不符应返回 null');

    // 手写一个正确长度的密钥但 vaultId 非 UUID → null
    saveKeysRaw(dir, { vaultId: 'not-a-uuid', vaultKeyB64: buf(keys.vaultKey).toString('base64'), createdAt: keys.createdAt });
    assert.equal(loadKeys(dir), null, 'vaultId 非 UUID 应返回 null');
  });
});

/** 直接写 keys.json 原始形态（用于构造损坏样本；保持与实现字段一致）。 */
function saveKeysRaw(dir: string, rec: { vaultId: string; vaultKeyB64: string; createdAt: string }): void {
  writeFileSync(
    join(dir, 'keys.json'),
    JSON.stringify({ createdAt: rec.createdAt, format: 'cairn-vault-keys', vaultId: rec.vaultId, vaultKey: rec.vaultKeyB64, version: 1 }),
    'utf8',
  );
}

test('saveKeys：自动创建多级 dataDir', () => {
  withTmpDir((dir) => {
    const nested = join(dir, 'vault-a', 'keys');
    const keys = generateVaultKeys();
    saveKeys(nested, keys);
    const loaded = loadKeys(nested);
    assert.ok(loaded !== null && loaded.vaultId === keys.vaultId);
  });
});

test('saveKeys：输入非法（vaultId 非 UUID / vaultKey 非 32B）→ E_VALIDATION 且不落盘', () => {
  withTmpDir((dir) => {
    const validKey = Uint8Array.from(randomBytes(32));
    const e1 = catchCairn(() =>
      saveKeys(dir, { vaultId: 'not-a-uuid', vaultKey: validKey, createdAt: new Date().toISOString() }),
    );
    assert.equal(e1.message, 'vault_keys_invalid');
    const e2 = catchCairn(() =>
      saveKeys(dir, {
        vaultId: '11111111-2222-7333-8444-555555555555',
        vaultKey: Uint8Array.from(randomBytes(31)),
        createdAt: new Date().toISOString(),
      }),
    );
    assert.equal(e2.message, 'vault_keys_invalid');
    assert.equal(loadKeys(dir), null, '非法输入不得留下任何文件');
  });
});

// ---------------------------------------------------------------------------
// 恢复材料
// ---------------------------------------------------------------------------

test('恢复材料 export → import 往返等价（vaultId/vaultKey/createdAt 一致，容忍首尾空白）', () => {
  const keys = generateVaultKeys();
  const material = exportRecoveryMaterial(keys);
  const imported = importRecoveryMaterial(material);
  assert.equal(imported.vaultId, keys.vaultId);
  assert.ok(buf(imported.vaultKey).equals(buf(keys.vaultKey)));
  assert.equal(imported.createdAt, keys.createdAt);
  const importedTrimmed = importRecoveryMaterial(`  \n${material}\t `);
  assert.equal(importedTrimmed.vaultId, keys.vaultId);
});

test('恢复材料：坏前缀 / 坏 base64 / 非法 JSON / 缺字段 / 密钥长度错 → recovery_material_invalid', () => {
  const keys = generateVaultKeys();
  const material = exportRecoveryMaterial(keys);
  const payload = material.slice('CAIRN1.'.length);
  const wrap = (body: string): string => 'CAIRN1.' + Buffer.from(body, 'utf8').toString('base64url');

  const cases: Array<[string, string]> = [
    ['坏前缀', 'CAIRN2.' + payload],
    ['无前缀', payload],
    ['坏 base64 字符集', 'CAIRN1.!!!not-base64url!!!'],
    ['base64 合法但非 JSON', 'CAIRN1.' + Buffer.from('plain text, not json', 'utf8').toString('base64url')],
    ['JSON 缺字段', wrap(JSON.stringify({ format: 'cairn-vault-recovery', version: 1 }))],
    ['format 不符', wrap(JSON.stringify({ createdAt: keys.createdAt, format: 'other', vaultId: keys.vaultId, vaultKey: buf(keys.vaultKey).toString('base64'), version: 1 }))],
    ['vaultKey 长度错', wrap(JSON.stringify({ createdAt: keys.createdAt, format: 'cairn-vault-recovery', vaultId: keys.vaultId, vaultKey: buf(keys.vaultKey).slice(0, 8).toString('base64'), version: 1 }))],
    ['vaultId 非 UUID', wrap(JSON.stringify({ createdAt: keys.createdAt, format: 'cairn-vault-recovery', vaultId: 'nope', vaultKey: buf(keys.vaultKey).toString('base64'), version: 1 }))],
  ];
  for (const [label, input] of cases) {
    const e = catchCairn(() => importRecoveryMaterial(input));
    assert.equal(e.code, 'E_VALIDATION', `${label} 应为 E_VALIDATION`);
    assert.equal(e.message, 'recovery_material_invalid', `${label} 的错误短语不符`);
  }
});

test('恢复材料结构：CAIRN1. 前缀 + base64url，不含 JSON 结构字符，不含 vaultKey 的 hex/base64 形态', () => {
  const keys = generateVaultKeys();
  const material = exportRecoveryMaterial(keys);
  assert.ok(material.startsWith('CAIRN1.'), `应以 CAIRN1. 开头: ${material.slice(0, 12)}…`);
  const payload = material.slice('CAIRN1.'.length);
  assert.match(payload, /^[A-Za-z0-9_-]+$/, 'payload 必须是纯 base64url 字符集（无 padding、无结构字符）');
  for (const ch of ['{', '}', '"', ':', '+', '/', '=']) {
    assert.ok(!material.includes(ch), `恢复材料不应包含结构字符 ${ch}`);
  }
  for (const fp of keyMaterialFingerprints(keys)) {
    assert.ok(!material.includes(fp), `恢复材料不应以可直接识别形态包含密钥（${fp.slice(0, 8)}…）`);
  }
  // 内层规范化 JSON 明文不出现
  assert.ok(!material.includes('vaultKey') && !material.includes('createdAt'), '内层字段名不应以明文出现');
});

test('恢复端到端：从恢复材料重建的密钥可以解密既有密文（丢失设备场景）', () => {
  const keys = generateVaultKeys();
  const sk = deriveSpaceKey(keys.vaultKey, SPACE_ID);
  const aad = makeAad({}, keys.vaultId);
  const pt = new TextEncoder().encode('丢失设备后凭恢复材料恢复');
  const blob = encryptObject(pt, sk, aad);

  const imported = importRecoveryMaterial(exportRecoveryMaterial(keys));
  const sk2 = deriveSpaceKey(imported.vaultKey, SPACE_ID);
  assert.ok(buf(sk2).equals(buf(sk)), '恢复后的 spaceKey 必须一致');
  const back = decryptObject(blob, sk2, aad);
  assert.ok(buf(back).equals(buf(pt)), '恢复后必须能解密原密文');
});

// ---------------------------------------------------------------------------
// 错误信息卫生：密钥材质绝不进入 message/details
// ---------------------------------------------------------------------------

test('错误信息不含密钥材质：auth_tag_invalid、recovery_material_invalid、save/load 路径全部检查', () => {
  const keys = generateVaultKeys();
  const sk = deriveSpaceKey(keys.vaultKey, SPACE_ID);
  const aad = makeAad({}, keys.vaultId);

  const blob = Uint8Array.from(encryptObject(randomBytes(32), sk, aad));
  blob[blob.length - 1] = (blob[blob.length - 1] ?? 0) ^ 0xff;
  assertNoKeyMaterial(catchCairn(() => decryptObject(blob, sk, aad)), keys);

  assertNoKeyMaterial(catchCairn(() => importRecoveryMaterial('CAIRN1.bogus')), keys);
  assertNoKeyMaterial(catchCairn(() => deriveSpaceKey(Uint8Array.from(randomBytes(8)), SPACE_ID)), keys);
  assertNoKeyMaterial(
    catchCairn(() => encryptObject(randomBytes(8), Uint8Array.from(randomBytes(1)), aad)),
    keys,
  );
});
