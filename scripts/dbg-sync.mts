// 一次性诊断（跑完即删）
import { openStore } from '../src/store/open.js';
import { generateVaultKeys, saveKeys, exportRecoveryMaterial, importRecoveryMaterial } from '../src/sync/cryptoutil.js';
import { syncPush } from '../src/sync/push.js';
import { syncPull } from '../src/sync/pull.js';
import { makeTestHome, cleanupTestHome } from '../tests/helpers.js';

class MemRemote {
  configured = true;
  objects = new Map<string, Uint8Array>();
  async getObject(k: string) { return this.objects.get(k) ?? null; }
  async putImmutable(k: string, b: Uint8Array) { this.objects.set(k, b); }
  async list(p: string) { const r = [...this.objects.keys()].filter((k) => k.startsWith(p)); console.log('[list]', p, '=>', r.length); return { keys: r }; }
  async getManifest(s: string, d: string) { console.log('[getManifest]', s, d); return this.objects.get(`${s}/devices/${d}/manifest.json`) ?? null; }
  async putManifest(s: string, d: string, m: unknown, g: number) {
    const k = `${s}/devices/${d}/manifest.json`;
    console.log('[putManifest]', k, 'gen', g);
    this.objects.set(k, new Uint8Array(m as Uint8Array));
  }
}
const remote = new MemRemote();
const homeA = makeTestHome();
const storeA = openStore({ home: homeA });
const keys = generateVaultKeys();
saveKeys(`${homeA}/data`, keys);
const vault = { vaultId: keys.vaultId, provider: 'syncd' as const, syncd: { baseUrl: 'http://x' }, createdAt: new Date().toISOString() };
const scope = storeA.scopes.resolvePreset('personal-global');
const m = storeA.memories.add({ kind: 'fact', content: '诊断记忆2', scopeId: scope.id, authority: 'user_explicit', createdBy: 'cli' }, storeA.identity.deviceId);
storeA.outbox.enqueue({ jobType: 'sync_upstream', scopeId: scope.id, entityType: 'memory', entityId: m.id, idempotencyKey: 'k1' });
const pushed = await syncPush(storeA, remote as never, vault);
console.log('pushed:', pushed?.eventCount, pushed?.publishedChunks?.length);
console.log('keys:', [...remote.objects.keys()]);
const homeB = makeTestHome();
const storeB = openStore({ home: homeB });
saveKeys(`${homeB}/data`, importRecoveryMaterial(exportRecoveryMaterial(keys)));
const pulled = await syncPull(storeB, remote as never, vault);
console.log('pulled:', JSON.stringify(pulled));
storeA.close(); storeB.close(); cleanupTestHome(homeA); cleanupTestHome(homeB);
