import { test } from 'node:test';
import assert from 'node:assert/strict';
import { URL_STATE_KEYS, URL_STATE_SRC } from '../../src/interfaces/console/assets/url-state.js';

/**
 * URL ←→ 视图状态编解码（任务 4.4 / 4.5）。
 *
 * 直接实例化页面里嵌入的那段源码，而不是另写一份等价逻辑——
 * 否则"测试通过"只能证明测试自己的实现是对的。
 */

const codec = new Function(
  'URLSearchParams',
  `${URL_STATE_SRC}; return { encodeState: encodeState, decodeState: decodeState };`,
)(URLSearchParams) as {
  encodeState(st: Record<string, string>): string;
  decodeState(search: string, savedMode: string | null): Record<string, string>;
};

function parse(q: string): URLSearchParams {
  return new URLSearchParams(q);
}

test('往返一致：全部白名单键都能原样还原', () => {
  const st = {
    view: 'batches',
    q: '构建命令',
    scope: 'scope-1',
    status: 'active',
    kind: 'fact',
    batch: 'b-1',
    plan: 'p-1',
    drawer: 'archive-1',
    item: 'item-9',
    mem: 'mem-1',
    mode: 'full',
  };
  const got = codec.decodeState('?' + codec.encodeState(st), null);
  assert.deepEqual(got, st);
});

test('白名单键表与页面源码里的 KEYS 一致', () => {
  // 页面里的 KEYS 是唯一实现，TS 侧的 URL_STATE_KEYS 只是给测试和文档用的镜像。
  // 两者漂移就意味着"测试断言的键"和"页面真的读写的键"不是同一批。
  const src = URL_STATE_SRC.match(/var KEYS = \[([^\]]+)\]/);
  assert.ok(src, 'URL_STATE_SRC 里应能找到 KEYS 定义');
  const inSrc = src![1]!.split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter((s) => s.length > 0);
  assert.deepEqual(inSrc, [...URL_STATE_KEYS]);
});

test('抽屉状态可分享：drawer + item 同时还原', () => {
  const st = { view: 'imports', drawer: 'archive-42', item: 'item-7', mode: 'brief' };
  const got = codec.decodeState('?' + codec.encodeState(st), null);
  assert.equal(got.drawer, 'archive-42');
  assert.equal(got.item, 'item-7');
  assert.equal(got.view, 'imports');
});

test('mem：详情标识往返，没打开详情时不写进地址', () => {
  // 详情可寻址（refine-memory-detail-drawer 3.1）：mem 与 drawer 是两个语义，
  // 各自独立往返，避免切视图时互相清错。
  assert.equal(parse(codec.encodeState({ view: 'memories', mem: 'mem-9', mode: 'brief' })).get('mem'), 'mem-9');
  assert.equal(parse(codec.encodeState({ view: 'memories', mode: 'brief' })).get('mem'), null, '没有详情就不该多一个空参数');
  assert.equal(codec.decodeState('?view=memories&mem=mem-9&mode=brief', null).mem, 'mem-9');
  assert.equal(codec.decodeState('?view=memories&mem=&mode=brief', null).mem, undefined, '空值按未打开处理');
  assert.equal(
    codec.decodeState('?view=imports&drawer=archive-1&mem=mem-9&mode=brief', null).drawer,
    'archive-1',
    '两个键并存时互不干扰',
  );
});

test('默认视图不写进 URL，保持地址干净', () => {
  const q = codec.encodeState({ view: 'overview', mode: 'brief' });
  assert.equal(parse(q).get('view'), null);
  assert.equal(parse(q).get('mode'), 'brief');
  assert.equal(codec.decodeState('?' + q, null).view, 'overview', '缺省视图必须回落到 overview');
});

test('mode 总是显式写入：链接可复现，不依赖接收方的本地偏好', () => {
  assert.equal(parse(codec.encodeState({ view: 'memories', mode: 'brief' })).get('mode'), 'brief');
  assert.equal(parse(codec.encodeState({ view: 'memories', mode: 'full' })).get('mode'), 'full');
  assert.equal(parse(codec.encodeState({ view: 'memories' })).get('mode'), 'brief', '未指定时按 brief');
});

test('URL 优先于 localStorage', () => {
  assert.equal(codec.decodeState('?mode=full', 'brief').mode, 'full');
  assert.equal(codec.decodeState('?mode=brief', 'full').mode, 'brief');
});

test('URL 未带 mode 时才回落到本地偏好', () => {
  assert.equal(codec.decodeState('', 'full').mode, 'full');
  assert.equal(codec.decodeState('?view=inbox', 'full').mode, 'full');
  assert.equal(codec.decodeState('', null).mode, 'brief');
  assert.equal(codec.decodeState('', '瞎写').mode, 'brief', '非法偏好值按 brief');
});

test('非法 mode 参数不被采信', () => {
  assert.equal(codec.decodeState('?mode=MEDIUM', 'full').mode, 'full');
  assert.equal(codec.decodeState('?mode=', 'brief').mode, 'brief');
});

test('中文与保留字符安全往返', () => {
  const st = { view: 'memories', q: 'a&b=c d/中文?', scope: 'x', mode: 'full' };
  const decoded = codec.decodeState('?' + codec.encodeState(st), null);
  assert.equal(decoded.q, 'a&b=c d/中文?');
  assert.equal(decoded.scope, 'x');
});

test('未知键被忽略，不会被注入进状态', () => {
  const got = codec.decodeState('?view=memories&evil=1&__proto__=x&mode=full', null);
  assert.equal(got.evil, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(got, '__proto__'), false);
  assert.deepEqual(Object.keys(got).sort(), ['mode', 'view']);
});

test('空值参数不写入（避免出现 scope= 这种空过滤）', () => {
  const got = codec.decodeState('?scope=&status=&mode=full', null);
  assert.equal(got.scope, undefined);
  assert.equal(got.status, undefined);
  assert.equal(got.mode, 'full');
});
