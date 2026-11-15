import { openStore } from '../dist/src/store/open.js';
import { loadKeys, deriveSpaceKey, decryptObject } from '../dist/src/sync/cryptoutil.js';
import { unpackChunk } from '../dist/src/sync/events.js';
import { contentHash as contentHashOf, normalizeContent, sha256Hex } from '../dist/src/core/hash.js';
import { SyncdRemoteStore } from '../dist/src/sync/syncd-store.js';

const VID = '01a1c44b-d59d-7464-a954-18b7074aa747';
const MYDEV = 'dev_01a18002-defd-7ba9-acd0-ae3fb1606b4e';
const PREFIX = `vaults/${VID}/`;
const remote = new SyncdRemoteStore({ baseUrl: 'http://100.65.135.122:8471', token: process.env.CAIRN_SYNCD_TOKEN, prefix: PREFIX });
const store = openStore({ home: 'C:/Users/Carlos/.cairn' });
const keys = loadKeys(store.paths.dataDir);

const report = { chains: {}, plaintextHits: [], decryptFailures: 0, totalObjects: 0 };

for (const spaceKey of ['personal-global', `preserve/${MYDEV}`]) {
  const listing = await remote.list(`${spaceKey}/devices/`);
  const objects = listing.keys;
  report.totalObjects += objects.length;
  const stats = { objects: objects.length, chunks: 0, manifests: 0, events: 0, byType: {}, upsertHashOk: 0, upsertHashBad: 0, descriptors: {} };
  for (const rel of objects) {
    if (rel.endsWith('/manifest.json')) {
      stats.manifests++;
      try {
      const dev = rel.split('/devices/')[1].split('/')[0];
      const sealed = await remote.getManifest(spaceKey, dev);
      const plain = decryptObject(sealed, deriveSpaceKey(keys.vaultKey, spaceKey), { vaultId: keys.vaultId, spaceId: spaceKey, kind: 'manifest', objectId: `manifest.json|${dev}` });
      const doc = JSON.parse(Buffer.from(plain).toString('utf8'));
      stats.manifestHeadSeq = doc.headSeq; stats.manifestChunks = doc.chunks.length;
      } catch (e) { report.decryptFailures++; process.stderr.write(`manifest fail ${rel}: ${e.message}
`); }
    } else {
      stats.chunks++;
      const sealed = await remote.getObject(rel);
      const mSha = /chunks\/(\d+)-([0-9a-f]{64})\.bin$/.exec(rel);
      if (!mSha) { process.stderr.write(`skip non-chunk probe object: ${rel}
`); continue; }
      try {
        // AAD objectId 与加密时一致 = chunk 相对 key（devices/<dev>/chunks/<seq>-<hash>.bin）
        const objectId = rel.slice(spaceKey.length + 1);
        const plain = decryptObject(sealed, deriveSpaceKey(keys.vaultKey, spaceKey), { vaultId: keys.vaultId, spaceId: spaceKey, kind: 'chunk', objectId });
        const { gunzipSync } = await import('node:zlib');
        const json = JSON.parse(gunzipSync(Buffer.from(plain)).toString('utf8'));
        const dev = rel.split('/devices/')[1].split('/')[0];
        if (json.deviceId !== dev) throw new Error(`device mismatch: ${json.deviceId} != ${dev}`);
        stats.events += json.events.length;
        for (const ev of json.events) {
          stats.byType[ev.type] = (stats.byType[ev.type] ?? 0) + 1;
          if (ev.type === 'memory_upsert' && ev.payload) {
            if (contentHashOf(ev.payload.content) === ev.payload.contentHash) stats.upsertHashOk++; else stats.upsertHashBad++;
            const d = ev.payload.scope;
            const key = d ? `${d.preset}${d.projectId ? '/' + d.projectId.slice(0, 8) : ''}${d.deviceId ? '/dev' : ''}` : 'MISSING';
            stats.descriptors[key] = (stats.descriptors[key] ?? 0) + 1;
          }
          if (ev.type === 'scope_exit') stats.scopeExits = (stats.scopeExits ?? 0) + 1;
        }
      } catch (e) {
        report.decryptFailures++;
        process.stderr.write(`decrypt fail ${rel}: ${e.message}\n`);
      }
    }
  }
  report.chains[spaceKey] = stats;
}

// 明文扫描：真实库中若干条保管链记忆正文的片段，不应出现在任何远端对象原始字节里
const samples = store.db.all(`SELECT m.content FROM memory m JOIN scope s ON s.id = m.scope_id WHERE s.preset IN ('device-local','project-global') AND m.status='active' ORDER BY m.updated_at DESC LIMIT 8`);
const allRaw = [];
for (const spaceKey of ['personal-global', `preserve/${MYDEV}`]) {
  for (const rel of (await remote.list(`${spaceKey}/devices/`)).keys) {
    const dev = rel.split('/devices/')[1]?.split('/')[0];
    const bytes = rel.endsWith('/manifest.json')
      ? await remote.getManifest(spaceKey, dev)
      : await remote.getObject(rel);
    if (bytes) allRaw.push(Buffer.from(bytes));
  }
}
for (const s of samples) {
  const needle = String(s.content).slice(0, 24);
  for (const buf of allRaw) {
    if (buf.toString('latin1').includes(needle) || buf.includes(Buffer.from(needle, 'utf8'))) {
      report.plaintextHits.push(needle.slice(0, 8) + '…');
    }
  }
}
report.plaintextSamples = samples.length;
store.close();
console.log(JSON.stringify(report, null, 1));
