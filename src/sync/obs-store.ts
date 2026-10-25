/**
 * Huawei OBS（S3 兼容）RemoteStore 实现（design D1：ObsRemoteStore）。
 *
 * 鉴权：OBS v2 头签名
 *   Authorization: OBS <AK>:<base64(hmac-sha1(SK, StringToSign))>
 *   StringToSign = `Verb\nContent-MD5\nContent-Type\nDate\nCanonicalizedResource`
 * 与官方 esdk-obs-nodejs 的 doAuth 行为对齐（已核对官方源码）：
 *   - 虚拟主机风格：URL 路径不带桶名，但 CanonicalizedResource 必须带 `/<bucket>/` 前缀；
 *   - CanonicalizedResource 使用 URL 编码后的对象路径（用户实测：原始中文 key 会 SignatureDoesNotMatch）；
 *     列举（无对象 key）时 CanonicalizedResource = `/<bucket>/`；
 *   - 列举 query（list-type/prefix/max-keys/continuation-token）不属于 v2 子资源，不参与签名；
 *     只有 `?acl`/`?location` 等子资源才计入（本实现不使用任何子资源）；
 *   - key 的 URL 编码 = 按 `/` 分段逐段 encodeURIComponent 后再用 `/` 连接（与 SDK
 *     encodeURIWithSafe(key, '/') 输出一致）。
 *
 * 凭据纪律（design D6 / spec「凭据不入日志」）：
 *   SK、AK、Authorization 头与签名串绝不进入任何错误的 message/details；
 *   OBS 403 响应体可能回显 StringToSign 与服务端计算的签名，因此错误一律不携带响应体；
 *   details 中仅允许 accessKeyIdMasked（前 4 后 2 打码）。
 *
 * key 语义：调用方传入的 key / list prefix / (space, device) 均相对配置的公共 prefix，
 * 本类只做 `prefix + key` 拼接与 URL 编码；chunk/manifest 的协议语义由调用方适配
 * （getManifest(space, device) = getObject(`${space}/${device}/manifest.json`)，putManifest 同理）。
 * OBS 无条件写、无服务端 CAS：manifest 防代次回退由调用方先 GET 自检（design D2）。
 */
import { createHash, createHmac } from 'node:crypto';
import { err, type CairnError } from '../core/errors.js';
import { sha256Hex } from '../core/hash.js';
import type { RemoteStore } from '../jobs/remote.js';

export interface ObsRemoteConfig {
  /** OBS endpoint，形如 https://obs.cn-east-3.myhuaweicloud.com；也兼容已带桶名的虚拟主机形态。 */
  endpoint: string;
  /** 桶名；既用于拼虚拟主机域名，也用于 CanonicalizedResource 的 /<bucket> 前缀。 */
  bucket: string;
  /** 对象 key 公共前缀（调用方 key 均相对该前缀），如 'cairn/'；按原样拼接，不自动补斜杠。 */
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface ObsRemoteStoreOptions {
  /** 默认 globalThis.fetch；测试注入假件即可离线运行，全部 HTTP 都经过该注入点。 */
  fetchImpl?: typeof fetch;
  /** 默认 () => new Date()；测试注入固定时钟以锁定 Date 头与签名向量。 */
  now?: () => Date;
}

/** 列举单页最大对象数（OBS 上限 1000）。 */
const LIST_MAX_KEYS = 1000;

/** RFC 3986 strict：encodeURIComponent 不编码的保留字符补齐为 %XX（与 SDK 逐字符编码一致）。 */
const STRICT_ENC_RE = /[!'()*]/g;

function encodeKeyPath(key: string): string {
  return key
    .split('/')
    .map((seg) => encodeURIComponent(seg).replace(STRICT_ENC_RE, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

function toBuffer(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function md5Hex(bytes: Uint8Array): string {
  return createHash('md5').update(toBuffer(bytes)).digest('hex');
}

function md5Base64(bytes: Uint8Array): string {
  return createHash('md5').update(toBuffer(bytes)).digest('base64');
}

/** AK 打码：前 4 后 2，中间 ****；过短则完全打码。 */
function maskAccessKeyId(ak: string): string {
  if (ak.length <= 6) return '******';
  return `${ak.slice(0, 4)}****${ak.slice(-2)}`;
}

function decodeXmlEntities(text: string): string {
  return text.replace(/&(?:#x([0-9a-fA-F]+)|#([0-9]+)|([a-zA-Z]+));/g, (whole, hex: string | undefined, dec: string | undefined, name: string | undefined) => {
    if (hex !== undefined && hex.length > 0) {
      const cp = parseInt(hex, 16);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
    }
    if (dec !== undefined && dec.length > 0) {
      const cp = parseInt(dec, 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
    }
    switch (name) {
      case 'amp': return '&';
      case 'lt': return '<';
      case 'gt': return '>';
      case 'quot': return '"';
      case 'apos': return "'";
      default: return whole;
    }
  });
}

interface ListPage {
  keys: string[];
  isTruncated: boolean;
  nextToken?: string;
}

/** 简单正则解析列举 XML：提取 <Key>、<IsTruncated>、<NextContinuationToken>（不引 XML 库）。 */
function parseListXml(xml: string): ListPage {
  const keys: string[] = [];
  for (const m of xml.matchAll(/<Key>([\s\S]*?)<\/Key>/g)) {
    keys.push(decodeXmlEntities(m[1] ?? ''));
  }
  const truncMatch = /<IsTruncated>\s*([a-zA-Z]+)\s*<\/IsTruncated>/.exec(xml);
  const isTruncated = truncMatch !== null && (truncMatch[1]?.toLowerCase() === 'true');
  let nextToken: string | undefined;
  const tokenMatch = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml);
  if (tokenMatch !== null && tokenMatch[1] !== undefined) {
    nextToken = decodeXmlEntities(tokenMatch[1]);
  }
  return { keys, isTruncated, nextToken };
}

interface SendOptions {
  body?: Uint8Array;
  contentType?: string;
  /** 追加在 URL 后的原始 query（如 ?list-type=2&...），不参与 v2 签名。 */
  query?: string;
}

export class ObsRemoteStore implements RemoteStore {
  readonly configured = true;

  readonly #cfg: ObsRemoteConfig;
  readonly #origin: string;
  readonly #fetchImpl: typeof fetch;
  readonly #now: () => Date;

  constructor(cfg: ObsRemoteConfig, opts?: ObsRemoteStoreOptions) {
    if (typeof cfg?.endpoint !== 'string' || cfg.endpoint.length === 0) {
      throw err('E_CONFIG_IO', 'obs_endpoint_invalid', { field: 'endpoint' });
    }
    let base: URL;
    try {
      base = new URL(cfg.endpoint);
    } catch {
      throw err('E_CONFIG_IO', 'obs_endpoint_invalid', { field: 'endpoint' });
    }
    if (base.protocol !== 'https:' && base.protocol !== 'http:') {
      throw err('E_CONFIG_IO', 'obs_endpoint_invalid', { field: 'endpoint' });
    }
    if (typeof cfg.bucket !== 'string' || cfg.bucket.length === 0) {
      throw err('E_CONFIG_IO', 'obs_config_invalid', { field: 'bucket' });
    }
    if (typeof cfg.accessKeyId !== 'string' || cfg.accessKeyId.length === 0) {
      throw err('E_CONFIG_IO', 'obs_config_invalid', { field: 'accessKeyId' });
    }
    if (typeof cfg.secretAccessKey !== 'string' || cfg.secretAccessKey.length === 0) {
      throw err('E_CONFIG_IO', 'obs_config_invalid', { field: 'secretAccessKey' });
    }
    if (typeof cfg.prefix !== 'string') {
      throw err('E_CONFIG_IO', 'obs_config_invalid', { field: 'prefix' });
    }
    this.#cfg = cfg;
    // 虚拟主机风格：host 前拼桶名；endpoint 已带桶名形态则不重复拼。
    let host = base.host;
    if (!host.startsWith(`${cfg.bucket}.`)) {
      host = `${cfg.bucket}.${host}`;
    }
    this.#origin = `${base.protocol}//${host}`;
    const fetchImpl = opts?.fetchImpl;
    this.#fetchImpl = fetchImpl ?? fetch.bind(globalThis);
    const now = opts?.now;
    this.#now = now ?? (() => new Date());
  }

  /** prefix + 相对 key；拒绝空 key 与以 / 开头的 key（拼接语义会被破坏）。 */
  #fullKey(key: string): string {
    if (typeof key !== 'string' || key.length === 0 || key.startsWith('/')) {
      throw err('E_VALIDATION', 'obs_key_invalid', { key: String(key) });
    }
    return this.#cfg.prefix + key;
  }

  #assertSegment(value: string, field: string): void {
    if (typeof value !== 'string' || value.length === 0 || value.includes('/')) {
      throw err('E_VALIDATION', 'obs_segment_invalid', { field });
    }
  }

  /**
   * 统一发送：计算 v2 头签名并经注入的 fetch 发出。
   * fullKey = null 表示桶根列举（resource = /<bucket>/，query 不参与签名）。
   */
  async #send(method: string, fullKey: string | null, sendOpts: SendOptions = {}): Promise<Response> {
    const dateHeader = this.#now().toUTCString();
    const contentMd5 = sendOpts.body !== undefined ? md5Base64(sendOpts.body) : '';
    const contentType = sendOpts.contentType ?? '';
    const path = fullKey === null ? '/' : `/${encodeKeyPath(fullKey)}`;
    const resource = `/${this.#cfg.bucket}${path}`;
    const stringToSign = [method, contentMd5, contentType, dateHeader, resource].join('\n');
    const signature = createHmac('sha1', this.#cfg.secretAccessKey).update(stringToSign, 'utf8').digest('base64');
    const headers: Record<string, string> = {
      date: dateHeader,
      authorization: `OBS ${this.#cfg.accessKeyId}:${signature}`,
    };
    if (contentMd5 !== '') headers['content-md5'] = contentMd5;
    if (contentType !== '') headers['content-type'] = contentType;
    const url = `${this.#origin}${path}${sendOpts.query ?? ''}`;
    const init: RequestInit = { method, headers };
    if (sendOpts.body !== undefined) {
      // 运行时 fetch 接受任何 TypedArray；仅因类型泛型差异收窄（全局不暴露 BodyInit 名）
      init.body = sendOpts.body as unknown as NonNullable<RequestInit['body']>;
    }
    try {
      return await this.#fetchImpl(url, init);
    } catch (e) {
      // fetch 失败信息不含头与凭据；不回显响应体
      throw err('E_IO', 'obs_network_error', { method, cause: e instanceof Error ? e.message : String(e) });
    }
  }

  /** 非 2xx 的统一错误映射。绝不携带响应体（403 body 可能含 StringToSign/签名）。 */
  #statusError(res: Response): CairnError {
    if (res.status === 403) {
      return err('E_FORBIDDEN', 'obs_access_denied', {
        accessKeyIdMasked: maskAccessKeyId(this.#cfg.accessKeyId),
      });
    }
    return err('E_IO', 'obs_remote_error', { status: res.status });
  }

  async getObject(key: string): Promise<Uint8Array | null> {
    const fullKey = this.#fullKey(key);
    const res = await this.#send('GET', fullKey);
    if (res.status === 200) {
      try {
        return new Uint8Array(await res.arrayBuffer());
      } catch (e) {
        throw err('E_IO', 'obs_network_error', { method: 'GET', cause: e instanceof Error ? e.message : String(e) });
      }
    }
    if (res.status === 404) return null;
    throw this.#statusError(res);
  }

  async putImmutable(key: string, bytes: Uint8Array, hash: string): Promise<void> {
    const fullKey = this.#fullKey(key);
    if (typeof hash !== 'string' || !/^[0-9a-fA-F]{64}$/.test(hash)) {
      // Cairn 全局 hash 形态为小写 sha256 hex（core/hash.ts），上传前先挡住非 sha256 输入
      throw err('E_VALIDATION', 'obs_hash_invalid', { key, hashLength: typeof hash === 'string' ? hash.length : -1 });
    }
    const expectedHash = hash.toLowerCase();
    const res = await this.#send('PUT', fullKey, { body: bytes, contentType: 'application/octet-stream' });
    if (res.status < 200 || res.status >= 300) {
      throw this.#statusError(res);
    }
    const etagRaw = res.headers.get('etag');
    if (etagRaw !== null && etagRaw.length > 0) {
      const etag = etagRaw.replace(/^"+|"+$/g, '').toLowerCase();
      // OBS 标准 ETag = 内容 MD5（32 位 hex），与调用方 sha256 hash 不可能直接相等；
      // 两者任一命中即完整：ETag==hash（通用 S3 兼容语义 / 假件测试），或
      // ETag==md5(bytes)（真实 OBS 传输完整性校验）。都不满足才判不一致。
      const etagIsMd5OfBody = etag.length === 32 && /^[0-9a-f]{32}$/.test(etag) && etag === md5Hex(bytes);
      if (etag !== expectedHash && !etagIsMd5OfBody) {
        throw err('E_IO', 'obs_integrity_mismatch', { key });
      }
    }
    // 无 ETag 头（少数兼容实现）：无法比对，按 2xx 接受
  }

  async list(prefix: string, cursor?: string): Promise<{ keys: string[]; nextCursor?: string }> {
    if (typeof prefix !== 'string' || prefix.startsWith('/')) {
      throw err('E_VALIDATION', 'obs_key_invalid', { prefix: String(prefix) });
    }
    if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length === 0)) {
      throw err('E_VALIDATION', 'obs_cursor_invalid', {});
    }
    const fullPrefix = this.#cfg.prefix + prefix;
    const keys: string[] = [];
    let nextCursor: string | undefined;
    let token = cursor;
    // 无 cursor：自动翻页直到 IsTruncated=false；传入 cursor：仅取一页（调用方控制节奏）。
    do {
      const query =
        `?list-type=2&prefix=${encodeURIComponent(fullPrefix)}&max-keys=${LIST_MAX_KEYS}` +
        (token !== undefined ? `&continuation-token=${encodeURIComponent(token)}` : '');
      const res = await this.#send('GET', null, { query });
      if (res.status < 200 || res.status >= 300) {
        throw this.#statusError(res);
      }
      let xml: string;
      try {
        xml = await res.text();
      } catch (e) {
        throw err('E_IO', 'obs_network_error', { method: 'GET', cause: e instanceof Error ? e.message : String(e) });
      }
      const page = parseListXml(xml);
      for (const k of page.keys) {
        // 只剥掉 store prefix：返回 keys 与 getObject 的相对 key 域一致（含 list 参数前缀部分），
        // 调用方可直接把列出的 key 回填 getObject
        if (k.startsWith(this.#cfg.prefix)) {
          keys.push(k.slice(this.#cfg.prefix.length));
        }
      }
      if (page.isTruncated) {
        if (page.nextToken === undefined) {
          throw err('E_IO', 'obs_list_token_missing', { status: res.status });
        }
        nextCursor = page.nextToken;
      } else {
        nextCursor = undefined;
      }
      if (cursor !== undefined) break;
      token = nextCursor;
    } while (token !== undefined);
    return nextCursor === undefined ? { keys } : { keys, nextCursor };
  }

  async getManifest(space: string, device: string): Promise<unknown | null> {
    this.#assertSegment(space, 'space');
    this.#assertSegment(device, 'device');
    const manifestKey = `${space}/${device}/manifest.json`;
    const bytes = await this.getObject(manifestKey);
    if (bytes === null) return null;
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch {
      throw err('E_IO', 'obs_manifest_invalid', { key: manifestKey });
    }
  }

  async putManifest(space: string, device: string, manifest: unknown, expectedGeneration: number): Promise<void> {
    this.#assertSegment(space, 'space');
    this.#assertSegment(device, 'device');
    if (typeof expectedGeneration !== 'number' || !Number.isInteger(expectedGeneration) || expectedGeneration < 0) {
      throw err('E_VALIDATION', 'obs_manifest_generation_invalid', { expectedGeneration: String(expectedGeneration) });
    }
    // OBS 无条件写、无服务端 CAS：expectedGeneration 仅作契约校验，
    // 防代次回退由调用方先 GET 自检后调用（design D2「自防回退」）。
    const bytes = new TextEncoder().encode(JSON.stringify(manifest));
    await this.putImmutable(`${space}/${device}/manifest.json`, bytes, sha256Hex(toBuffer(bytes)));
  }

  /**
   * 删除对象（内部维护能力，供后续 purge 使用；不放入 RemoteStore 接口）。
   * 404 视为已删除（幂等）。
   */
  async deleteObject(key: string): Promise<void> {
    const fullKey = this.#fullKey(key);
    const res = await this.#send('DELETE', fullKey);
    if (res.status === 404) return;
    if (res.status < 200 || res.status >= 300) {
      throw this.#statusError(res);
    }
  }
}

/**
 * 从环境变量构造 ObsRemoteStore：OBS_ENDPOINT / OBS_BUCKET / OBS_PREFIX /
 * OBS_ACCESS_KEY_ID / OBS_SECRET_ACCESS_KEY。任一缺失或为空返回 null（诚实降级，
 * 由调用方落到 NotConfiguredRemote 语义）；endpoint 形态非法则抛 E_CONFIG_IO（错误配置应显式暴露）。
 */
export function obsRemoteFromEnv(env?: Record<string, string | undefined>): ObsRemoteStore | null {
  const source: Record<string, string | undefined> = env ?? process.env;
  const endpoint = source['OBS_ENDPOINT'];
  const bucket = source['OBS_BUCKET'];
  const prefix = source['OBS_PREFIX'];
  const accessKeyId = source['OBS_ACCESS_KEY_ID'];
  const secretAccessKey = source['OBS_SECRET_ACCESS_KEY'];
  if (!endpoint || !bucket || !prefix || !accessKeyId || !secretAccessKey) {
    return null;
  }
  return new ObsRemoteStore({ endpoint, bucket, prefix, accessKeyId, secretAccessKey });
}
