import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryPreview } from '../../src/retrieval/preview.js';

/**
 * add-two-stage-memory-recall D2：preview 是 frontmatter 感知、确定性（同输入同字节、
 * 无时间因素）的单点投影，上限 300 字符。列表工具的条目以它替代全文。
 */

test('preview：frontmatter 记忆取 name 值开头，结构行不进预览', () => {
  const content = '---\nname: 备份策略\nkind: fact\n---\n每日备份重要数据到本地磁盘\n第二段正文';
  const p = memoryPreview(content);
  assert.ok(p.preview.startsWith('备份策略'), `name 值优先作为预览开头，实际 ${p.preview}`);
  assert.ok(p.preview.includes('每日备份'), '正文进入预览');
  assert.ok(!p.preview.includes('kind: fact'), 'frontmatter 结构行不进预览');
  assert.equal(p.truncated, false, '有效内容未超上限');
  assert.equal(p.contentLength, content.length);
});

test('preview：无 frontmatter 的纯正文直接展开', () => {
  const p = memoryPreview('普通记忆正文');
  assert.equal(p.preview, '普通记忆正文');
  assert.equal(p.truncated, false);
  assert.equal(p.contentLength, '普通记忆正文'.length);
});

test('preview：超上限截断并带省略号，truncated=true，长度有界', () => {
  const long = '很长的正文。'.repeat(100);
  const p = memoryPreview(long);
  assert.equal(p.truncated, true);
  assert.ok(p.preview.length <= 300, `预览长度 ${p.preview.length} 必须 ≤ 300`);
  assert.ok(p.preview.endsWith('…'));
  assert.equal(p.contentLength, long.length);
});

test('preview：确定性——同输入同字节', () => {
  const c = '---\nname: X\n---\n某正文，含  半角空格与\n换行';
  const a = memoryPreview(c);
  const b = memoryPreview(c);
  assert.equal(a.preview, b.preview);
});

test('preview：换行折叠为单行（注入行是单行格式）', () => {
  const p = memoryPreview('第一行\n第二行\n第三行');
  assert.ok(!p.preview.includes('\n'), '预览不得含换行');
});
