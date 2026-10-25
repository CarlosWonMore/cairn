// 解密核查：OBS cairn/ 前缀下全部 chunk 解密【并解压】后不得包含指定金丝雀（argv[2]）。
// chunk 明文是 gzip(JSON)——不解压直接搜字符串必然搜不到（第三轮验证 P1：恒真漏报）。
// 需要 vault 密钥——从 argv[3]（recovery 材料）或环境 CAIRN_VERIFY_RECOVERY 读取。
import { gunzipSync } from 'node:zlib';
import { ObsRemoteStore } from '../src/sync/obs-store.js';
import { importRecoveryMaterial, deriveSpaceKey, decryptObject } from '../src/sync/cryptoutil.js';

const canary = process.argv[2] ?? '';
const recoveryText = process.argv[3] ?? process.env['CAIRN_VERIFY_RECOVERY'] ?? '';
if (!canary || !recoveryText) {
  console.error('usage: obs-no-local-leak.mts <canary> <recovery-material>');
  process.exit(1);
}
const keys = importRecoveryMaterial(recoveryText);
const cfg = {
  endpoint: process.env['OBS_ENDPOINT']!,
  bucket: process.env['OBS_BUCKET']!,
  prefix: process.env['OBS_PREFIX']!,
  accessKeyId: process.env['OBS_ACCESS_KEY_ID']!,
  secretAccessKey: process.env['OBS_SECRET_ACCESS_KEY']!,
};
const store = new ObsRemoteStore(cfg);
const all: string[] = [];
let cursor: string | undefined;
for (;;) {
  const r = await store.list('', cursor);
  all.push(...r.keys);
  if (!r.nextCursor) break;
  cursor = r.nextCursor;
}
const spaceKeyBytes = deriveSpaceKey(keys.vaultKey, 'personal-global');
let checked = 0;
for (const key of all) {
  const rel = key.slice(cfg.prefix.length);
  const bytes = await store.getObject(rel);
  if (!bytes) continue;
  if (rel.endsWith('/manifest.json')) {
    const m = rel.match(/devices\/([^/]+)\/manifest\.json$/);
    if (!m) continue;
    const plain = decryptObject(bytes, spaceKeyBytes, { vaultId: keys.vaultId, spaceId: 'personal-global', kind: 'manifest', objectId: `manifest.json|${m[1]}` });
    checked++;
    if (Buffer.from(plain).toString('utf8').includes(canary)) {
      console.error('LEAK in manifest:', rel);
      process.exit(1);
    }
    continue;
  }
  const plain = decryptObject(bytes, spaceKeyBytes, { vaultId: keys.vaultId, spaceId: 'personal-global', kind: 'chunk', objectId: rel });
  // chunk 明文是 gzip(JSON)：必须解压后再比对，否则恒不命中（漏报）
  const unzipped = gunzipSync(Buffer.from(plain));
  checked++;
  if (unzipped.toString('utf8').includes(canary)) {
    console.error('LEAK in chunk:', rel);
    process.exit(1);
  }
}
console.log(JSON.stringify({ checked, canary, leak: false }));
