/**
 * 记忆调用状态测试。
 *
 * 重点锁死两条：三态必须可分（尤其「已过滤」不能退化成「未命中」），
 * 以及状态里绝不含正文全文。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildUsage, toSummary } from '../src/usage-state.js';

describe('三态判定', () => {
  it('有注入时是 injected', () => {
    const u = buildUsage({
      candidates: 3,
      injectable: [{ id: 'a', kind: 'fact', content: '投影预算是 2KB' }],
      injectedIds: ['a'],
      matchedBy: 'fts',
      bytesUsed: 40,
      bytesBudget: 1536,
      filteredCount: 0,
    });
    assert.equal(u.status, 'injected');
    assert.equal(u.label, '已注入');
    assert.equal(u.injected.length, 1);
  });

  it('命中但被过滤时是 filtered，不是 miss（核心区分）', () => {
    const u = buildUsage({
      candidates: 2,
      injectable: [],
      injectedIds: [],
      matchedBy: 'fts',
      bytesUsed: 0,
      bytesBudget: 1536,
      filteredCount: 2,
    });
    assert.equal(u.status, 'filtered');
    assert.equal(u.label, '已过滤');
    assert.notEqual(u.status, 'miss', '被过滤不能与未命中混为一谈');
    assert.equal(u.filteredCount, 2);
  });

  it('没有候选时是 miss', () => {
    const u = buildUsage({
      candidates: 0,
      injectable: [],
      injectedIds: [],
      matchedBy: 'none',
      bytesUsed: 0,
      bytesBudget: 1536,
      filteredCount: 0,
    });
    assert.equal(u.status, 'miss');
    assert.equal(u.label, '未命中');
  });

  it('有候选但全部没进注入且无过滤 → miss（预算裁掉也算没注入）', () => {
    const u = buildUsage({
      candidates: 5,
      injectable: [{ id: 'a', kind: 'fact', content: '内容' }],
      injectedIds: [],
      matchedBy: 'fts',
      bytesUsed: 0,
      bytesBudget: 10,
      filteredCount: 0,
    });
    assert.equal(u.status, 'miss');
  });
});

describe('摘要裁剪：正文不进入状态', () => {
  it('截断到 60 字符并加省略号', () => {
    const long = '很长的内容'.repeat(50);
    const s = toSummary(long);
    assert.ok(s.length <= 60, `实际 ${s.length}`);
    assert.ok(s.endsWith('…'));
  });

  it('只取首行，不保留换行', () => {
    const s = toSummary('第一行内容\n第二行内容\n第三行');
    assert.equal(s, '第一行内容');
    assert.ok(!s.includes('\n'));
  });

  it('短内容原样保留', () => {
    assert.equal(toSummary('投影预算是 2KB'), '投影预算是 2KB');
  });
});

describe('injected 只含真正注入的条目', () => {
  it('未进入 injectedIds 的条目不出现', () => {
    const u = buildUsage({
      candidates: 2,
      injectable: [
        { id: 'a', kind: 'fact', content: '进了注入的' },
        { id: 'b', kind: 'fact', content: '被预算裁掉的' },
      ],
      injectedIds: ['a'],
      matchedBy: 'fts',
      bytesUsed: 30,
      bytesBudget: 1536,
      filteredCount: 0,
    });
    assert.deepEqual(u.injected.map((i) => i.id), ['a']);
  });
});
