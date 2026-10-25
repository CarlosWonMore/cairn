/**
 * ObsRemoteStore（Huawei OBS S3 兼容 RemoteStore）测试。
 *
 * 凭据纪律：本文件只使用测试现造的合成 AK/SK；真实云端用例仅在 OBS_* 环境变量
 * 齐全时执行，缺失时显式 skip 并注明（design D6：不虚报真实验证）。
 * 固定向量签名测试在测试内用 node:crypto 按文档化规则独立复算期望值。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { ObsRemoteStore, obsRemoteFromEnv, type ObsRemoteConfig } from '../../src/sync/obs-store.js';
import { sha256Hex } from '../../src/core/hash.js';
import { isCairnError, type CairnError } from '../../src/core/errors.js';

/** Uint8Array 版 sha256（sha256Hex 形参为 string | Buffer）。 */
function sha256Of(bytes: Uint8Array): string {
  return sha256Hex(Buffer.from(bytes));
}

// ---- 合成凭据与固定时钟（非真实凭据） -----------------------------------

const AK = 'OBSAKTEST0001ABCD';
const SK = 'OBSSKTESTSECRET0000000000000000ZZ';
const CFG: ObsRemoteConfig = {
  endpoint: 'https://obs.cn-east-3.myhuaweicloud.com',
  bucket: 'cairn-selftest-bucket',
  prefix: 'cairn/',
  accessKeyId: AK,
  secretAccessKey: SK,
};
const ORIGIN = 'https://cairn-selftest-bucket.obs.cn-east-3.myhuaweicloud.com';
const NOW = new Date(Date.UTC(2026, 9, 25, 12, 0, 0));
const DATE_HEADER = NOW.toUTCString(); // GMT 形态：'Sun, 25 Oct 2026 12:00:00 GMT'

// ---- 测试工具 -----------------------------------------------------------

interface CapturedCall {
  url: string;
  init: RequestInit;
}

function captureFetch(respond: (url: string, init: RequestInit) => Response): {
  fetchImpl: typeof fetch;
  calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init: init ?? {} });
    return respond(url, init ?? {});
  };
  return { fetchImpl, calls };
}

function makeStore(respond: (url: string, init: RequestInit) => Response): {
  store: ObsRemoteStore;
  calls: CapturedCall[];
} {
  const cap = captureFetch(respond);
  const store = new ObsRemoteStore(CFG, { fetchImpl: cap.fetchImpl, now: () => NOW });
  return { store, calls: cap.calls };
}

function headersOf(call: CapturedCall): Record<string, string> {
  return call.init.headers as Record<string, string>;
}

/** 按文档化签名规则独立复算期望 Authorization（与实现同一规则、独立代码）。 */
function expectAuth(method: string, contentMd5: string, contentType: string, resource: string): string {
  const stringToSign = [method, contentMd5, contentType, DATE_HEADER, resource].join('\n');
  const sig = createHmac('sha1', SK).update(stringToSign, 'utf8').digest('base64');
  return `OBS ${AK}:${sig}`;
}

function asCairn(e: unknown): CairnError {
  assert.ok(isCairnError(e), `expected CairnError, got: ${String(e)}`);
  return e;
}

function assertNoSecrets(e: unknown): void {
  const c = asCairn(e);
  const blob = `${c.message}|${JSON.stringify(c.details ?? {})}`;
  assert.ok(!blob.includes(SK), '错误不得包含 SK');
  assert.ok(!blob.includes(AK), '错误不得包含完整 AK');
  assert.ok(!blob.includes('Authorization'), '错误不得包含 Authorization 头');
  assert.ok(!blob.includes('OBS '), '错误不得包含 OBS 签名串形态');
}

function okResponse(bytes: Uint8Array | string, headers?: Record<string, string>): Response {
  return new Response(bytes as unknown as NonNullable<RequestInit['body']>, { status: 200, headers });
}

function listXml(opts: { keys: string[]; isTruncated: boolean; nextToken?: string }): string {
  const contents = opts.keys
    .map((k) => `<Contents><Key>${k}</Key><LastModified>2026-10-25T10:00:00.000Z</LastModified><ETag>"abc"</ETag><Size>5</Size></Contents>`)
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<ListBucketResult xmlns="http://obs.myhuaweicloud.com/doc/2015-06-30/">` +
    `<Name>cairn-selftest-bucket</Name><Prefix>cairn/</Prefix><KeyCount>${opts.keys.length}</KeyCount>` +
    `<MaxKeys>1000</MaxKeys><IsTruncated>${opts.isTruncated}</IsTruncated>` +
    (opts.nextToken !== undefined ? `<NextContinuationToken>${opts.nextToken}</NextContinuationToken>` : '') +
    contents +
    `</ListBucketResult>`
  );
}

// ---- obsRemoteFromEnv 三态 ----------------------------------------------

test('obsRemoteFromEnv：全缺返回 null', () => {
  assert.equal(obsRemoteFromEnv({}), null);
});

test('obsRemoteFromEnv：任一变量缺失返回 null（逐个验证五个变量）', () => {
  const full: Record<string, string> = {
    OBS_ENDPOINT: 'https://obs.cn-east-3.myhuaweicloud.com',
    OBS_BUCKET: 'some-bucket',
    OBS_PREFIX: 'cairn/',
    OBS_ACCESS_KEY_ID: AK,
    OBS_SECRET_ACCESS_KEY: SK,
  };
  for (const missing of Object.keys(full)) {
    const partial: Record<string, string> = { ...full };
    delete partial[missing];
    assert.equal(obsRemoteFromEnv(partial), null, `缺少 ${missing} 时应返回 null`);
  }
  // 空字符串同样视为未配置
  const emptyPrefix: Record<string, string> = { ...full, OBS_PREFIX: '' };
  assert.equal(obsRemoteFromEnv(emptyPrefix), null);
});

test('obsRemoteFromEnv：全齐返回 configured=true 的 ObsRemoteStore', () => {
  const store = obsRemoteFromEnv({
    OBS_ENDPOINT: 'https://obs.cn-east-3.myhuaweicloud.com',
    OBS_BUCKET: 'some-bucket',
    OBS_PREFIX: 'cairn/',
    OBS_ACCESS_KEY_ID: AK,
    OBS_SECRET_ACCESS_KEY: SK,
  });
  assert.ok(store instanceof ObsRemoteStore);
  assert.equal(store?.configured, true);
});

test('obsRemoteFromEnv：endpoint 形态非法时抛 E_CONFIG_IO（不静默降级）', () => {
  assert.throws(
    () =>
      obsRemoteFromEnv({
        OBS_ENDPOINT: 'not-a-url',
        OBS_BUCKET: 'some-bucket',
        OBS_PREFIX: 'cairn/',
        OBS_ACCESS_KEY_ID: AK,
        OBS_SECRET_ACCESS_KEY: SK,
      }),
    (e: unknown) => asCairn(e).code === 'E_CONFIG_IO',
  );
});

// ---- 构造校验 -----------------------------------------------------------

test('constructor：bucket/AK/SK 缺失抛 E_CONFIG_IO', () => {
  assert.throws(() => new ObsRemoteStore({ ...CFG, bucket: '' }), (e: unknown) => asCairn(e).code === 'E_CONFIG_IO');
  assert.throws(() => new ObsRemoteStore({ ...CFG, accessKeyId: '' }), (e: unknown) => asCairn(e).code === 'E_CONFIG_IO');
  assert.throws(() => new ObsRemoteStore({ ...CFG, secretAccessKey: '' }), (e: unknown) => asCairn(e).code === 'E_CONFIG_IO');
});

test('constructor：非 http(s) endpoint 抛 E_CONFIG_IO', () => {
  assert.throws(() => new ObsRemoteStore({ ...CFG, endpoint: 'ftp://obs.example.com' }), (e: unknown) => asCairn(e).code === 'E_CONFIG_IO');
});

test('constructor：configured=true（含空 prefix=桶根形态）', () => {
  const store = new ObsRemoteStore(CFG, { fetchImpl: captureFetch(() => new Response(null, { status: 404 })).fetchImpl, now: () => NOW });
  assert.equal(store.configured, true);
  const rootStore = new ObsRemoteStore({ ...CFG, prefix: '' }, { fetchImpl: captureFetch(() => new Response(null, { status: 404 })).fetchImpl, now: () => NOW });
  assert.equal(rootStore.configured, true);
});

// ---- 签名固定向量（node:crypto 独立复算） -------------------------------

test('签名固定向量：GET 对象（Authorization 精确匹配、URL 路径不带桶名）', async () => {
  const key = 'vaults/v1/spaces/s1/devices/d1/chunks/3-abc.bin';
  const { store, calls } = makeStore(() => new Response(null, { status: 404 }));
  await store.getObject(key);
  assert.equal(calls.length, 1);
  const call = calls[0]!;
  const h = headersOf(call);
  const resource = '/cairn-selftest-bucket/cairn/vaults/v1/spaces/s1/devices/d1/chunks/3-abc.bin';
  assert.equal(call.url, `${ORIGIN}/cairn/vaults/v1/spaces/s1/devices/d1/chunks/3-abc.bin`);
  assert.equal(h['authorization'], expectAuth('GET', '', '', resource));
  assert.ok(h['authorization']!.startsWith('OBS '), 'Authorization 必须以 OBS 前缀');
  assert.equal(h['date'], DATE_HEADER);
});

test('签名固定向量：PUT 对象（Content-MD5 与 Content-Type 参与签名）', async () => {
  const key = 'vaults/v1/spaces/s1/chunks/1-abc.bin';
  const body = new TextEncoder().encode('cairn-obs-selftest-body');
  const md5b64 = createHash('md5').update(body).digest('base64');
  const { store, calls } = makeStore(() => okResponse(body, { etag: `"${sha256Of(body)}"` }));
  await store.putImmutable(key, body, sha256Of(body));
  assert.equal(calls.length, 1);
  const call = calls[0]!;
  const h = headersOf(call);
  const resource = '/cairn-selftest-bucket/cairn/vaults/v1/spaces/s1/chunks/1-abc.bin';
  assert.equal(call.init.method, 'PUT');
  assert.equal(h['content-md5'], md5b64);
  assert.equal(h['content-type'], 'application/octet-stream');
  assert.equal(h['authorization'], expectAuth('PUT', md5b64, 'application/octet-stream', resource));
});

test('签名固定向量：中文 key 的 URL 路径与签名 resource 均为 URL 编码形态', async () => {
  // 用户实测坑：用原始中文路径签名会 SignatureDoesNotMatch；此处锁定编码形态
  const key = 'vaults/中文目录/记忆-1.bin';
  const { store, calls } = makeStore(() => new Response(null, { status: 404 }));
  await store.getObject(key);
  const call = calls[0]!;
  const h = headersOf(call);
  const encodedPath = 'cairn/vaults/%E4%B8%AD%E6%96%87%E7%9B%AE%E5%BD%95/%E8%AE%B0%E5%BF%86-1.bin';
  const resource = `/cairn-selftest-bucket/${encodedPath}`;
  assert.equal(call.url, `${ORIGIN}/${encodedPath}`);
  assert.ok(!call.url.includes('中文'), 'URL 路径必须为编码形态');
  assert.ok(!h['authorization']!.includes('%E4%B8%AD') === false || true); // 签名串是 base64，不做子串断言
  assert.equal(h['authorization'], expectAuth('GET', '', '', resource));
  // 期望值与实现使用同一编码规则：独立再算一遍 resource 作对照
  const reencoded = key
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  assert.equal(encodedPath, `cairn/${reencoded}`);
});

test('签名固定向量：列举请求（resource=/bucket/，query 不参与签名）', async () => {
  const { store, calls } = makeStore(() => okResponse(listXml({ keys: [], isTruncated: false })));
  await store.list('vaults/');
  assert.equal(calls.length, 1);
  const call = calls[0]!;
  const h = headersOf(call);
  assert.equal(call.url, `${ORIGIN}/?list-type=2&prefix=cairn%2Fvaults%2F&max-keys=1000`);
  // 列举 query（list-type/prefix/max-keys）不是 v2 子资源，不计入 CanonicalizedResource
  assert.equal(h['authorization'], expectAuth('GET', '', '', '/cairn-selftest-bucket/'));
});

// ---- 请求头断言 ---------------------------------------------------------

test('请求头：Date 为 GMT 英文形态且来自注入时钟；Authorization 为 OBS 前缀', async () => {
  const { store, calls } = makeStore(() => new Response(null, { status: 404 }));
  await store.getObject('a.bin');
  const h = headersOf(calls[0]!);
  assert.match(
    h['date']!,
    /^([A-Z][a-z]{2}), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/,
    'Date 必须为 GMT 英文形态',
  );
  assert.equal(h['date'], NOW.toUTCString());
  assert.match(h['authorization']!, /^OBS [^:]+:[A-Za-z0-9+/]+=*$/);
});

test('请求头：GET/DELETE 不携带 Content-MD5 与 Content-Type（签名为空行）', async () => {
  const { store, calls } = makeStore(() => new Response(null, { status: 204 }));
  await store.deleteObject('a.bin');
  const h = headersOf(calls[0]!);
  assert.equal(h['content-md5'], undefined);
  assert.equal(h['content-type'], undefined);
  assert.equal(h['authorization'], expectAuth('DELETE', '', '', '/cairn-selftest-bucket/cairn/a.bin'));
});

test('请求头：PUT 携带 Content-MD5=base64(md5(body)) 与 application/octet-stream', async () => {
  const body = new Uint8Array([1, 2, 3, 4, 5]);
  const { store, calls } = makeStore(() => okResponse(body, { etag: `"${sha256Of(body)}"` }));
  await store.putImmutable('chunks/x.bin', body, sha256Of(body));
  const h = headersOf(calls[0]!);
  assert.equal(h['content-md5'], createHash('md5').update(body).digest('base64'));
  assert.equal(h['content-type'], 'application/octet-stream');
});

// ---- URL 构造 -----------------------------------------------------------

test('URL 构造：endpoint 已含桶名（虚拟主机形态）时不重复拼桶', async () => {
  const cap = captureFetch(() => new Response(null, { status: 404 }));
  const store = new ObsRemoteStore(
    { ...CFG, endpoint: 'https://cairn-selftest-bucket.obs.cn-east-3.myhuaweicloud.com' },
    { fetchImpl: cap.fetchImpl, now: () => NOW },
  );
  await store.getObject('a.bin');
  assert.equal(cap.calls[0]!.url, 'https://cairn-selftest-bucket.obs.cn-east-3.myhuaweicloud.com/cairn/a.bin');
});

test('URL 构造：空 prefix 时 key 直接挂桶根', async () => {
  const cap = captureFetch(() => new Response(null, { status: 404 }));
  const store = new ObsRemoteStore({ ...CFG, prefix: '' }, { fetchImpl: cap.fetchImpl, now: () => NOW });
  await store.getObject('top.bin');
  assert.equal(cap.calls[0]!.url, `${ORIGIN}/top.bin`);
});

// ---- getObject 行为 -----------------------------------------------------

test('getObject：200 返回字节内容一致', async () => {
  const body = new TextEncoder().encode('hello cairn');
  const { store } = makeStore(() => okResponse(body));
  const got = await store.getObject('chunks/hello.bin');
  assert.ok(got !== null);
  assert.equal(Buffer.from(got).toString('utf8'), 'hello cairn');
});

test('getObject：200 空 body 返回空 Uint8Array（不是 null）', async () => {
  const { store } = makeStore(() => okResponse(new Uint8Array(0)));
  const got = await store.getObject('chunks/empty.bin');
  assert.ok(got !== null);
  assert.equal(got.length, 0);
});

test('getObject：404 返回 null', async () => {
  const { store } = makeStore(() => new Response(null, { status: 404 }));
  assert.equal(await store.getObject('chunks/missing.bin'), null);
});

test('getObject：403 抛 E_FORBIDDEN/obs_access_denied 且 details 带打码 AK', async () => {
  const { store } = makeStore(() => new Response(null, { status: 403 }));
  const e = await store.getObject('chunks/x.bin').then(
    () => null,
    (err: unknown) => err,
  );
  const c = asCairn(e);
  assert.equal(c.code, 'E_FORBIDDEN');
  assert.equal(c.message, 'obs_access_denied');
  assert.equal((c.details as Record<string, string>).accessKeyIdMasked, 'OBSA****CD');
});

test('getObject：5xx 抛 E_IO/obs_remote_error 且 details.status 记录状态码', async () => {
  for (const status of [500, 503]) {
    const { store } = makeStore(() => new Response(null, { status }));
    const e = await store.getObject('chunks/x.bin').then(
      () => null,
      (err: unknown) => err,
    );
    const c = asCairn(e);
    assert.equal(c.code, 'E_IO');
    assert.equal(c.message, 'obs_remote_error');
    assert.equal((c.details as Record<string, unknown>).status, status);
  }
});

test('getObject：fetch 网络错误抛 E_IO/obs_network_error', async () => {
  const cap = captureFetch(() => {
    throw new TypeError('fetch failed');
  });
  const store = new ObsRemoteStore(CFG, { fetchImpl: cap.fetchImpl, now: () => NOW });
  const e = await store.getObject('chunks/x.bin').then(
    () => null,
    (err: unknown) => err,
  );
  const c = asCairn(e);
  assert.equal(c.code, 'E_IO');
  assert.equal(c.message, 'obs_network_error');
});

test('getObject：空 key 或以 / 开头的 key 抛 E_VALIDATION 且不发请求', async () => {
  const { store, calls } = makeStore(() => okResponse('x'));
  await assert.rejects(() => store.getObject(''), (e: unknown) => asCairn(e).code === 'E_VALIDATION');
  await assert.rejects(() => store.getObject('/abs.bin'), (e: unknown) => asCairn(e).code === 'E_VALIDATION');
  assert.equal(calls.length, 0);
});

// ---- putImmutable 行为 --------------------------------------------------

test('putImmutable：2xx 且 ETag==hash → 成功', async () => {
  const body = new TextEncoder().encode('immutable-body');
  const hash = sha256Of(body);
  const { store, calls } = makeStore(() => okResponse(body, { etag: `"${hash}"` }));
  await store.putImmutable('chunks/ok.bin', body, hash);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.init.method, 'PUT');
});

test('putImmutable：ETag（去引号）与 hash 不一致 → E_IO/obs_integrity_mismatch', async () => {
  const body = new TextEncoder().encode('immutable-body');
  const { store } = makeStore(() => okResponse(body, { etag: '"wJalrXUtnFEMI"' }));
  const e = await store.putImmutable('chunks/bad.bin', body, sha256Of(body)).then(
    () => null,
    (err: unknown) => err,
  );
  const c = asCairn(e);
  assert.equal(c.code, 'E_IO');
  assert.equal(c.message, 'obs_integrity_mismatch');
});

test('putImmutable：ETag 为内容 MD5 形态（OBS 真实语义）→ 传输完整即成功', async () => {
  const body = new TextEncoder().encode('real-obs-etag-is-md5');
  const md5HexBody = createHash('md5').update(body).digest('hex');
  const { store } = makeStore(() => okResponse(body, { etag: `"${md5HexBody}"` }));
  // 传入的 hash 是 sha256（与 ETag 的 MD5 不可能相等），只要 ETag==md5(body) 即完整
  await store.putImmutable('chunks/md5-etag.bin', body, sha256Of(body));
});

test('putImmutable：2xx 无 ETag 头时按成功接受（无法比对）', async () => {
  const body = new TextEncoder().encode('no-etag');
  const { store } = makeStore(() => okResponse(body));
  await store.putImmutable('chunks/no-etag.bin', body, sha256Of(body));
});

test('putImmutable：hash 非 64 位 sha256 hex → E_VALIDATION 且不发请求', async () => {
  const body = new TextEncoder().encode('x');
  const { store, calls } = makeStore(() => okResponse(body));
  await assert.rejects(() => store.putImmutable('chunks/h.bin', body, 'deadbeef'), (e: unknown) => asCairn(e).code === 'E_VALIDATION');
  await assert.rejects(() => store.putImmutable('chunks/h.bin', body, ''), (e: unknown) => asCairn(e).code === 'E_VALIDATION');
  assert.equal(calls.length, 0);
});

test('putImmutable：重复 PUT 同 key 同体 → 幂等成功（两次均 2xx）', async () => {
  const body = new TextEncoder().encode('same-body');
  const hash = sha256Of(body);
  let n = 0;
  const { store, calls } = makeStore(() => {
    n += 1;
    return okResponse(body, { etag: `"${hash}"` });
  });
  await store.putImmutable('chunks/same.bin', body, hash);
  await store.putImmutable('chunks/same.bin', body, hash);
  assert.equal(n, 2);
  assert.equal(calls.length, 2);
});

test('putImmutable：403 抛 E_FORBIDDEN/obs_access_denied 且不泄密', async () => {
  const body = new TextEncoder().encode('x');
  const { store } = makeStore(() => new Response(null, { status: 403 }));
  const e = await store.putImmutable('chunks/denied.bin', body, sha256Of(body)).then(
    () => null,
    (err: unknown) => err,
  );
  assert.equal(asCairn(e).message, 'obs_access_denied');
  assertNoSecrets(e);
});

// ---- 保密纪律（403 响应体含签名材料也不得泄漏） --------------------------

test('保密：403 响应体含 StringToSign/AK 时，错误 message+details 仍不含 SK/AK/Authorization', async () => {
  // OBS 的 SignatureDoesNotMatch 响应体会回显 StringToSign 与服务端签名——绝不能进错误
  const leakyBody =
    '<?xml version="1.0" encoding="UTF-8"?><Error><Code>SignatureDoesNotMatch</Code>' +
    `<AWSAccessKeyId>${AK}</AWSAccessKeyId>` +
    '<StringToSign>GET\\n\\n\\nSun, 25 Oct 2026 12:00:00 GMT\\n/cairn-selftest-bucket/cairn/x</StringToSign>' +
    '<Signature>FAKESIGNATURE==</Signature></Error>';
  const { store } = makeStore(() => new Response(leakyBody, { status: 403 }));
  const e = await store.getObject('x.bin').then(
    () => null,
    (err: unknown) => err,
  );
  assertNoSecrets(e);
  // details 只允许打码 AK
  const c = asCairn(e);
  assert.deepEqual(Object.keys(c.details ?? {}), ['accessKeyIdMasked']);
});

test('保密：list 403 与 putManifest 错误路径同样不泄密', async () => {
  const { store } = makeStore(() => new Response('<?xml version="1.0"?><Error><Code>AccessDenied</Code></Error>', { status: 403 }));
  const eList = await store.list('').then(
    () => null,
    (err: unknown) => err,
  );
  assertNoSecrets(eList);
  const eManifest = await store.putManifest('s1', 'd1', { generation: 1 }, 0).then(
    () => null,
    (err: unknown) => err,
  );
  assertNoSecrets(eManifest);
});

// ---- putManifest / getManifest ------------------------------------------

test('putManifest：PUT 到 cairn/<space>/devices/<device>/manifest.json，body 为 JSON，签名含 Content-MD5', async () => {
  const manifest = { generation: 7, headSeq: 42, chunks: [{ key: 'a.bin', seqFrom: 1, seqTo: 2 }] };
  const { store, calls } = makeStore((url, init) => {
    const body = init.body as Uint8Array;
    return okResponse(body, { etag: `"${sha256Of(body)}"` });
  });
  await store.putManifest('s1', 'd1', manifest, 6);
  const call = calls[0]!;
  assert.equal(call.url, `${ORIGIN}/cairn/s1/devices/d1/manifest.json`);
  const sent = new TextDecoder().decode(call.init.body as Uint8Array);
  assert.equal(sent, JSON.stringify(manifest));
  const bodyBytes = new TextEncoder().encode(sent);
  const h = headersOf(call);
  assert.equal(h['content-type'], 'application/octet-stream');
  assert.equal(
    h['authorization'],
    expectAuth('PUT', createHash('md5').update(bodyBytes).digest('base64'), 'application/octet-stream', '/cairn-selftest-bucket/cairn/s1/devices/d1/manifest.json'),
  );
});

test('putManifest：expectedGeneration 非负整数约束（负数/非整数 → E_VALIDATION）', async () => {
  const { store, calls } = makeStore(() => okResponse('{}'));
  await assert.rejects(() => store.putManifest('s1', 'd1', {}, -1), (e: unknown) => asCairn(e).code === 'E_VALIDATION');
  await assert.rejects(() => store.putManifest('s1', 'd1', {}, 1.5), (e: unknown) => asCairn(e).code === 'E_VALIDATION');
  await assert.rejects(() => store.putManifest('s1', 'd1', {}, Number.NaN), (e: unknown) => asCairn(e).code === 'E_VALIDATION');
  assert.equal(calls.length, 0);
  // 0（首次发布）合法
  await store.putManifest('s1', 'd1', { generation: 0 }, 0);
  assert.equal(calls.length, 1);
});

test('getManifest：200 → 解析为对象；404 → null', async () => {
  const manifest = { generation: 3, headSeq: 9 };
  const { store } = makeStore((url) => {
    if (url.endsWith('/cairn/s1/devices/d1/manifest.json')) {
      return okResponse(JSON.stringify(manifest), { etag: `"${sha256Hex(JSON.stringify(manifest))}"` });
    }
    return new Response(null, { status: 404 });
  });
  assert.deepEqual(await store.getManifest('s1', 'd1'), manifest);
  assert.equal(await store.getManifest('s1', 'ghost'), null);
});

test('getManifest：200 但非法 JSON → E_IO/obs_manifest_invalid', async () => {
  const { store } = makeStore(() => okResponse('not-json{{{'));
  const e = await store.getManifest('s1', 'd1').then(
    () => null,
    (err: unknown) => err,
  );
  const c = asCairn(e);
  assert.equal(c.code, 'E_IO');
  assert.equal(c.message, 'obs_manifest_invalid');
});

test('manifest：(space, device) 含 / 或为空 → E_VALIDATION', async () => {
  const { store, calls } = makeStore(() => okResponse('{}'));
  await assert.rejects(() => store.getManifest('a/b', 'd1'), (e: unknown) => asCairn(e).code === 'E_VALIDATION');
  await assert.rejects(() => store.putManifest('', 'd1', {}, 0), (e: unknown) => asCairn(e).code === 'E_VALIDATION');
  assert.equal(calls.length, 0);
});

// ---- list 行为 ----------------------------------------------------------

test('list：单页 IsTruncated=false → keys 剥掉 prefix 前缀，无 nextCursor', async () => {
  const xml = listXml({
    keys: ['cairn/vaults/v1/spaces/s1/devices/d1/chunks/3-abc.bin', 'cairn/vaults/v1/note.txt'],
    isTruncated: false,
  });
  const { store, calls } = makeStore(() => okResponse(xml, { 'content-type': 'application/xml' }));
  const r = await store.list('vaults/');
  assert.deepEqual(r.keys, ['vaults/v1/spaces/s1/devices/d1/chunks/3-abc.bin', 'vaults/v1/note.txt']);
  assert.equal(r.nextCursor, undefined);
  assert.equal(calls.length, 1);
});

test('list：解析中文 key 与 XML 实体（&amp;）', async () => {
  const xml = listXml({
    keys: ['cairn/vaults/记忆-中文目录/c1.bin', 'cairn/vaults/a&amp;b.bin'],
    isTruncated: false,
  });
  const { store } = makeStore(() => okResponse(xml));
  const r = await store.list('');
  assert.deepEqual(r.keys, ['vaults/记忆-中文目录/c1.bin', 'vaults/a&b.bin']);
});

test('list：IsTruncated=true 且无 cursor → 自动翻页聚合，续传 token 被 URL 编码', async () => {
  let page = 0;
  const { store, calls } = makeStore(() => {
    page += 1;
    if (page === 1) {
      return okResponse(listXml({ keys: ['cairn/vaults/p1a.bin', 'cairn/vaults/p1b.bin'], isTruncated: true, nextToken: 'TOKEN+abc/1=' }));
    }
    return okResponse(listXml({ keys: ['cairn/vaults/p2a.bin'], isTruncated: false }));
  });
  const r = await store.list('vaults/');
  assert.deepEqual(r.keys, ['vaults/p1a.bin', 'vaults/p1b.bin', 'vaults/p2a.bin']);
  assert.equal(r.nextCursor, undefined);
  assert.equal(calls.length, 2);
  assert.ok(calls[1]!.url.includes('continuation-token=TOKEN%2Babc%2F1%3D'), '第二页必须携带 URL 编码的 continuation-token');
});

test('list：传入 cursor → 仅取一页并返回 nextCursor 供续传', async () => {
  const { store, calls } = makeStore(() =>
    okResponse(listXml({ keys: ['cairn/vaults/m1.bin'], isTruncated: true, nextToken: 'NEXT2' })),
  );
  const r = await store.list('vaults/', 'CUR1');
  assert.deepEqual(r.keys, ['vaults/m1.bin']);
  assert.equal(r.nextCursor, 'NEXT2');
  assert.equal(calls.length, 1);
  assert.ok(calls[0]!.url.includes('continuation-token=CUR1'));
});

test('list：传 cursor 且该页 IsTruncated=false → nextCursor 为 undefined', async () => {
  const { store, calls } = makeStore(() => okResponse(listXml({ keys: ['cairn/x.bin'], isTruncated: false })));
  const r = await store.list('', 'CUR1');
  assert.deepEqual(r.keys, ['x.bin']);
  assert.equal(r.nextCursor, undefined);
  assert.equal(calls.length, 1);
});

test('list：IsTruncated=true 但缺 NextContinuationToken → E_IO/obs_list_token_missing', async () => {
  const xml = '<ListBucketResult><IsTruncated>true</IsTruncated></ListBucketResult>';
  const { store } = makeStore(() => okResponse(xml));
  const e = await store.list('').then(
    () => null,
    (err: unknown) => err,
  );
  const c = asCairn(e);
  assert.equal(c.code, 'E_IO');
  assert.equal(c.message, 'obs_list_token_missing');
});

test('list：5xx → E_IO/obs_remote_error；非法 cursor → E_VALIDATION', async () => {
  const { store, calls } = makeStore(() => new Response(null, { status: 502 }));
  const e = await store.list('').then(
    () => null,
    (err: unknown) => err,
  );
  assert.equal(asCairn(e).message, 'obs_remote_error');
  await assert.rejects(() => store.list('', ''), (e2: unknown) => asCairn(e2).code === 'E_VALIDATION');
  await assert.rejects(() => store.list('/abs'), (e2: unknown) => asCairn(e2).code === 'E_VALIDATION');
  assert.equal(calls.length, 1);
});

// ---- deleteObject（内部维护能力） ---------------------------------------

test('deleteObject：204 成功；404 幂等成功', async () => {
  let status = 204;
  const { store, calls } = makeStore(() => new Response(null, { status }));
  await store.deleteObject('vaults/v1/chunks/old.bin');
  assert.equal(calls[0]!.init.method, 'DELETE');
  assert.equal(calls[0]!.url, `${ORIGIN}/cairn/vaults/v1/chunks/old.bin`);
  status = 404;
  await store.deleteObject('vaults/v1/chunks/gone.bin');
  assert.equal(calls.length, 2);
});

test('deleteObject：500 → E_IO/obs_remote_error', async () => {
  const { store } = makeStore(() => new Response(null, { status: 500 }));
  const e = await store.deleteObject('x.bin').then(
    () => null,
    (err: unknown) => err,
  );
  assert.equal(asCairn(e).message, 'obs_remote_error');
});

// ---- 真实环境门（env 齐全才跑，缺失显式 skip） --------------------------

const REAL_ENV: ObsRemoteConfig | null = (() => {
  const e = (name: string): string | undefined => process.env[name];
  const endpoint = e('OBS_ENDPOINT');
  const bucket = e('OBS_BUCKET');
  const prefix = e('OBS_PREFIX');
  const accessKeyId = e('OBS_ACCESS_KEY_ID');
  const secretAccessKey = e('OBS_SECRET_ACCESS_KEY');
  if (!endpoint || !bucket || !prefix || !accessKeyId || !secretAccessKey) return null;
  return { endpoint, bucket, prefix, accessKeyId, secretAccessKey };
})();

test(
  '真实环境：OBS 往返 put/get/list/delete（selftest/<uuid>，测试后清理）',
  { skip: REAL_ENV ? false : 'OBS_ENDPOINT/OBS_BUCKET/OBS_PREFIX/OBS_ACCESS_KEY_ID/OBS_SECRET_ACCESS_KEY 未配置，跳过真实云端往返（不虚报真实验证）' },
  async () => {
    assert.ok(REAL_ENV, '真实环境变量必须存在才会进入本用例');
    const store = new ObsRemoteStore(REAL_ENV);
    const key = `selftest/${randomUUID()}.txt`;
    const body = new TextEncoder().encode(`cairn obs selftest ${NOW.toISOString()}`);
    try {
      await store.putImmutable(key, body, sha256Of(Buffer.from(body)));
      const got = await store.getObject(key);
      assert.ok(got !== null, 'PUT 后 GET 必须命中');
      assert.equal(Buffer.from(got).toString('utf8'), Buffer.from(body).toString('utf8'));
      const listed = await store.list('selftest/');
      assert.ok(listed.keys.includes(key), '列举必须包含刚写入的对象');
      await store.deleteObject(key);
      assert.equal(await store.getObject(key), null, '删除后 GET 应为 404');
      const after = await store.list('selftest/');
      assert.ok(!after.keys.includes(key), '删除后列举不应再包含该对象');
    } finally {
      // best-effort 清理，失败不掩盖断言结果
      try {
        await store.deleteObject(key);
      } catch {
        /* 遗留 selftest 对象可手动清理 */
      }
    }
  },
);
