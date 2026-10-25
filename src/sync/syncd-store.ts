import { err } from '../core/errors.js';
import { RemoteStore } from '../jobs/remote.js';
import { sha256Hex } from '../core/hash.js';

/**
 * ECS syncd 的客户端实现：同一 RemoteStore 合同。
 * manifest 代次经 X-Cairn-Generation 头做服务器端 CAS（回退 409）。
 */

export interface SyncdRemoteConfig {
  baseUrl: string;
  token: string;
}

export class SyncdRemoteStore implements RemoteStore {
  readonly configured = true;

  constructor(
    private readonly cfg: SyncdRemoteConfig,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  private async req(method: string, path: string, body?: Uint8Array, headers: Record<string, string> = {}): Promise<{ status: number; body: Uint8Array; text: string }> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.cfg.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.cfg.token}`,
          ...(body ? { 'content-type': 'application/octet-stream' } : {}),
          ...headers,
        },
        body: body ? Buffer.from(body) : undefined,
      });
    } catch (e) {
      // 网络层失败不透传原始堆栈（错误卫生）；不含 baseUrl/token
      throw err('E_IO', 'syncd_network_error', { code: (e as { code?: string }).code ?? 'unknown' });
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    return { status: res.status, body: buf, text: Buffer.from(buf).toString('utf8') };
  }

  async getObject(key: string): Promise<Uint8Array | null> {
    const r = await this.req('GET', `/chunks/${encodeURIComponent(key)}`);
    if (r.status === 404) return null;
    if (r.status === 401) throw err('E_FORBIDDEN', 'syncd_auth_failed');
    if (r.status !== 200) throw err('E_IO', 'syncd_remote_error', { status: r.status });
    return r.body;
  }

  async putImmutable(key: string, bytes: Uint8Array, hash: string): Promise<void> {
    const actual = sha256Hex(Buffer.from(bytes));
    if (actual !== hash) throw err('E_IO', 'syncd_local_hash_mismatch');
    const r = await this.req('PUT', `/chunks/${encodeURIComponent(key)}`, bytes);
    if (r.status === 401) throw err('E_FORBIDDEN', 'syncd_auth_failed');
    if (r.status !== 200) throw err('E_IO', 'syncd_remote_error', { status: r.status });
  }

  async list(prefix: string, _cursor?: string): Promise<{ keys: string[]; nextCursor?: string }> {
    const r = await this.req('GET', `/list?prefix=${encodeURIComponent(prefix)}`);
    if (r.status === 401) throw err('E_FORBIDDEN', 'syncd_auth_failed');
    if (r.status !== 200) throw err('E_IO', 'syncd_remote_error', { status: r.status });
    const parsed = JSON.parse(r.text) as { keys: string[] };
    return { keys: parsed.keys };
  }

  async getManifest(space: string, device: string): Promise<Uint8Array | null> {
    const key = `${space}/devices/${device}/manifest.json`;
    const r = await this.req('GET', `/manifests/${encodeURIComponent(key)}`);
    if (r.status === 404) return null;
    if (r.status === 401) throw err('E_FORBIDDEN', 'syncd_auth_failed');
    if (r.status !== 200) throw err('E_IO', 'syncd_remote_error', { status: r.status });
    return r.body;
  }

  async putManifest(space: string, device: string, manifest: Uint8Array, expectedGeneration: number): Promise<void> {
    const key = `${space}/devices/${device}/manifest.json`;
    const bytes = Buffer.from(manifest);
    const r = await this.req('PUT', `/manifests/${encodeURIComponent(key)}`, new Uint8Array(bytes), {
      'x-cairn-generation': String(expectedGeneration),
    });
    if (r.status === 409) throw err('E_CONFLICT_STATE', 'syncd_manifest_generation_regression', { detail: r.text.slice(0, 200) });
    if (r.status === 401) throw err('E_FORBIDDEN', 'syncd_auth_failed');
    if (r.status !== 200) throw err('E_IO', 'syncd_remote_error', { status: r.status });
  }
}
