import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MASK_CHAR,
  baseHeaders,
  contentView,
  guardRequest,
  maskBlock,
  newToken,
  sanitizeLabel,
  tokenEquals,
} from '../../src/interfaces/console/security.js';

const SECRET_TEXT = '数据库口令是 hunter2-not-a-real-secret';
const TOKEN = 'a'.repeat(64);

const POLICY = {
  token: TOKEN,
  allowedHosts: ['127.0.0.1:7767', 'localhost:7767'],
  allowedOrigins: ['http://127.0.0.1:7767', 'http://localhost:7767'],
};

test('security: 令牌校验拒绝缺失与错误，接受正确', () => {
  const ok = guardRequest(
    { method: 'GET', host: '127.0.0.1:7767', origin: undefined, secFetchSite: undefined, token: TOKEN },
    POLICY,
  );
  assert.equal(ok.ok, true);

  const missing = guardRequest(
    { method: 'GET', host: '127.0.0.1:7767', origin: undefined, secFetchSite: undefined, token: undefined },
    POLICY,
  );
  assert.equal(missing.ok, false);
  assert.equal(!missing.ok && missing.status, 401);
  assert.equal(!missing.ok && missing.reason, 'token_missing_or_invalid');

  const wrong = guardRequest(
    { method: 'GET', host: '127.0.0.1:7767', origin: undefined, secFetchSite: undefined, token: 'b'.repeat(64) },
    POLICY,
  );
  assert.equal(wrong.ok, false);
  assert.equal(!wrong.ok && wrong.status, 401);

  // 前缀相同的短令牌不得通过（长度不等即拒）
  const prefix = guardRequest(
    { method: 'GET', host: '127.0.0.1:7767', origin: undefined, secFetchSite: undefined, token: 'a'.repeat(63) },
    POLICY,
  );
  assert.equal(prefix.ok, false);
});

test('security: 跨源 POST 被拒（Origin 白名单 + Sec-Fetch-Site）', () => {
  const crossOrigin = guardRequest(
    {
      method: 'POST',
      host: '127.0.0.1:7767',
      origin: 'https://evil.example',
      secFetchSite: undefined,
      token: TOKEN,
    },
    POLICY,
  );
  assert.equal(crossOrigin.ok, false);
  assert.equal(!crossOrigin.ok && crossOrigin.status, 403);
  assert.equal(!crossOrigin.ok && crossOrigin.reason, 'origin_not_allowed');

  const crossSite = guardRequest(
    { method: 'POST', host: '127.0.0.1:7767', origin: 'http://127.0.0.1:7767', secFetchSite: 'cross-site', token: TOKEN },
    POLICY,
  );
  assert.equal(crossSite.ok, false);
  assert.equal(!crossSite.ok && crossSite.reason, 'cross_site_blocked');

  const sameOrigin = guardRequest(
    { method: 'POST', host: '127.0.0.1:7767', origin: 'http://127.0.0.1:7767', secFetchSite: 'same-origin', token: TOKEN },
    POLICY,
  );
  assert.equal(sameOrigin.ok, true);

  // curl 无 Origin 但有令牌：允许（本机脚本自动化是合法用法）
  const noOrigin = guardRequest(
    { method: 'POST', host: '127.0.0.1:7767', origin: undefined, secFetchSite: undefined, token: TOKEN },
    POLICY,
  );
  assert.equal(noOrigin.ok, true);
});

test('security: 非回环 Host 被拒（DNS rebinding）', () => {
  for (const host of ['evil.example', '127.0.0.1:8080', '192.168.1.5:7767', '', 'localhost']) {
    const v = guardRequest(
      { method: 'GET', host, origin: undefined, secFetchSite: undefined, token: TOKEN },
      POLICY,
    );
    assert.equal(v.ok, false, `Host=${host} 应被拒`);
    assert.equal(!v.ok && v.status, 403);
    assert.equal(!v.ok && v.reason, 'host_not_allowed');
  }
});

test('security: Host 判定先于令牌判定（诊断稳定）', () => {
  const v = guardRequest(
    { method: 'GET', host: 'evil.example', origin: undefined, secFetchSite: undefined, token: undefined },
    POLICY,
  );
  assert.equal(!v.ok && v.reason, 'host_not_allowed', '非回环 Host 不应被令牌缺失掩盖');
});

test('security: 掩码不泄原文（长度与哈希保留）', () => {
  const view = contentView(SECRET_TEXT, { masked: true });
  assert.equal(view.masked, true);
  assert.equal(view.text, null);
  assert.equal(view.length, SECRET_TEXT.length);
  assert.match(view.hashPrefix, /^[0-9a-f]{12}$/);
  assert.ok(!JSON.stringify(view).includes('hunter2'));
  const block = maskBlock(view);
  assert.ok(block.includes(MASK_CHAR));
  assert.ok(!block.includes('hunter2'));
});

test('security: brief 裁切保留 truncated 标记且不越界', () => {
  const text = 'Y'.repeat(500);
  const view = contentView(text, { maxChars: 100 });
  assert.equal(view.truncated, true);
  assert.equal(view.text!.length, 100);
  assert.equal(view.length, 500);

  const exact = contentView('Z'.repeat(100), { maxChars: 100 });
  assert.equal(exact.truncated, false);
  assert.equal(exact.text!.length, 100);
});

test('security: 来源标识折叠本机绝对路径', () => {
  const label = 'C:\\Users\\Carlos\\Documents\\notes\\MEMORY.md';
  assert.equal(sanitizeLabel(label), '~\\Documents\\notes\\MEMORY.md');
  const posix = '/home/alice/.config/memory.md';
  assert.equal(sanitizeLabel(posix), '~/.config/memory.md');
  assert.equal(sanitizeLabel(null), null);
  // 不含绝对路径的普通标签保持不变
  assert.equal(sanitizeLabel('codebuddy:MEMORY.md'), 'codebuddy:MEMORY.md');
});

test('security: 响应头声明不缓存并锁死来源', () => {
  const h = baseHeaders('application/json; charset=utf-8');
  assert.match(String(h['Cache-Control']), /no-store/);
  assert.equal(h['X-Content-Type-Options'], 'nosniff');
  assert.equal(h['X-Frame-Options'], 'DENY');
  assert.match(String(h['Content-Security-Policy']), /default-src 'none'/);
  assert.match(String(h['Content-Security-Policy']), /frame-ancestors 'none'/);
});

test('security: 令牌是 256 位随机且两次不同', () => {
  const a = newToken();
  const b = newToken();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, b);
  assert.equal(tokenEquals(a, a), true);
  assert.equal(tokenEquals(a, b), false);
  assert.equal(tokenEquals(a, null), false);
  assert.equal(tokenEquals(undefined, undefined), false);
});
