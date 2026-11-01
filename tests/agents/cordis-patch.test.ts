/**
 * Cordis 插件树 patch 文件行级编辑器测试（tasks 2.1–2.4）。
 *
 * 关键证据点：
 * - 块边界正确，注释与块外行不被计入；
 * - 幂等（重复 upsert 第二次 changed=false 且逐字节不变）；
 * - 移除只删本产品块，其余逐字保留；
 * - 四类结构不符各自硬失败且不产生输出。
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CAIRN_DSH_ENTRY_ID,
  findCairnInsert,
  hasCairnInsert,
  removeCairnInsert,
  renderCairnInsert,
  scanPatchBlocks,
  upsertCairnInsert,
  type CordisEntrySpec,
} from '../../src/agents/cordisPatch.js';
import { isCairnError } from '../../src/core/errors.js';

const SPEC: CordisEntrySpec = {
  command: 'D:/Program Files/nodejs/node.exe',
  args: ['D:/Project/AI MemoryGLM/dist/src/interfaces/mcp/server.js'],
};

/** 抄自真实 DSH patch 文件的形态：注释、flow-style 行、普通插件行。 */
const REAL_SHAPE = [
  '# Your patch layer for this dsh profile, applied after every bundle layer:',
  '# a top-level YAML array of loader patch entries (id-targeted config',
  '# overrides, disables, and insert lists; `!!js` expressions allowed).',
  '- { id: computer-use-cua-driver-native, disabled: false }',
  '- id: dsh-connect-workbuddy',
  '  name: dsh-connect-workbuddy',
  '  config:',
  '    regions:',
  '      cn:',
  '        enabled: true',
  '- id: agent-preset-registry',
  '  name: "@deepseek-ai/dsh-agent-preset-registry"',
  '  config:',
  '    default: standard',
  '',
].join('\n');

function forCode(code: string) {
  return (e: unknown): boolean => isCairnError(e) && e.code === code;
}

describe('scanPatchBlocks：块边界', () => {
  it('空文件 / 纯注释无 insert 块时返回空数组', () => {
    assert.deepEqual(scanPatchBlocks(''), []);
    assert.deepEqual(scanPatchBlocks('# only comments\n'), []);
  });

  it('识别单个 insert 块范围，且不把后续普通条目算进块内', () => {
    const text = REAL_SHAPE + renderCairnInsert(SPEC).join('\n') + '\n- id: tail-entry\n  name: tail\n';
    const blocks = scanPatchBlocks(text);
    assert.equal(blocks.length, 1);
    const b = blocks[0]!;
    assert.equal(b.containsCairn, true);
    const lines = text.split('\n');
    assert.equal(lines[b.startLine], '- insert:');
    assert.equal(lines[b.endLine], '- id: tail-entry', '块结束应停在下一个顶层条目行');
  });

  it('注释行不出现在块内（块尾注释被修剪到块外）', () => {
    const text = '- id: a\n  name: a\n- insert:\n    - id: x\n      name: x\n# note after block\n- id: b\n';
    const blocks = scanPatchBlocks(text);
    assert.equal(blocks.length, 1);
    const lines = text.split('\n');
    const blockText = lines.slice(blocks[0]!.startLine, blocks[0]!.endLine).join('\n');
    assert.ok(!blockText.includes('# note after block'), '块尾注释不属于块');
  });
});

describe('upsertCairnInsert：新增 / 替换 / 幂等', () => {
  it('不存在时追加一个 insert 块，且既有内容逐字保留', () => {
    const r = upsertCairnInsert(REAL_SHAPE, SPEC);
    assert.equal(r.changed, true);
    assert.equal(r.action, 'inserted');
    assert.ok(r.output.startsWith(REAL_SHAPE), '既有内容必须是输出前缀（逐字保留）');
    assert.ok(r.output.includes('- insert:'));
    assert.ok(r.output.includes('id: ' + CAIRN_DSH_ENTRY_ID));
    assert.ok(r.output.endsWith('\n'));
  });

  it('重复 upsert 同内容：changed=false 且输出逐字节等于输入', () => {
    const first = upsertCairnInsert(REAL_SHAPE, SPEC);
    const second = upsertCairnInsert(first.output, SPEC);
    assert.equal(second.changed, false);
    assert.equal(second.action, 'unchanged');
    assert.equal(second.output, first.output);
  });

  it('内容变化时整体替换该块，不产生第二块', () => {
    const first = upsertCairnInsert(REAL_SHAPE, SPEC);
    const newer: CordisEntrySpec = { command: 'D:/node.exe', args: ['D:/new.js'] };
    const second = upsertCairnInsert(first.output, newer);
    assert.equal(second.changed, true);
    assert.equal(second.action, 'replaced');
    assert.equal((second.output.match(/- insert:/g) ?? []).length, 1, '必须仍然只有一个 insert 块');
    assert.ok(second.output.includes('D:/new.js'));
    assert.ok(!second.output.includes(SPEC.args[0]!), '旧参数不得残留');
  });

  it('空文件被拒绝（不在无条目文件上猜结构）', () => {
    assert.throws(() => upsertCairnInsert('', SPEC), forCode('E_CONFIG_CONFLICT'));
    assert.throws(() => upsertCairnInsert('# only comment\n', SPEC), forCode('E_CONFIG_CONFLICT'));
  });

  it('command 为空 / args 非数组被拒绝', () => {
    assert.throws(() => renderCairnInsert({ command: '', args: [] }), forCode('E_VALIDATION'));
    assert.throws(
      () => renderCairnInsert({ command: 'x', args: null as unknown as string[] }),
      forCode('E_VALIDATION'),
    );
  });
});

describe('removeCairnInsert：只删本产品块', () => {
  it('已有块时移除后与原始文本一致（新增再删除的往返）', () => {
    const added = upsertCairnInsert(REAL_SHAPE, SPEC);
    const removed = removeCairnInsert(added.output);
    assert.equal(removed.changed, true);
    assert.equal(removed.output, REAL_SHAPE, '往返必须逐字节回到原始文本');
  });

  it('没有本产品块时 changed=false 且输出不变', () => {
    const r = removeCairnInsert(REAL_SHAPE);
    assert.equal(r.changed, false);
    assert.equal(r.output, REAL_SHAPE);
  });

  it('块位于中间时，前后内容都保留', () => {
    const head = '- id: head\n  name: head\n';
    const tail = '- id: tail\n  name: tail\n';
    const text = head + renderCairnInsert(SPEC).join('\n') + '\n' + tail;
    const removed = removeCairnInsert(text);
    assert.equal(removed.changed, true);
    assert.ok(removed.output.includes('id: head'));
    assert.ok(removed.output.includes('id: tail'));
    assert.ok(!removed.output.includes('- insert:'), '整个 insert 块（含首行）必须被移除');
  });
});

describe('结构不符：硬失败（design D3）', () => {
  it('顶层不是数组', () => {
    assert.throws(() => upsertCairnInsert('foo: bar\n', SPEC), forCode('E_CONFIG_CONFLICT'));
    assert.throws(() => findCairnInsert('foo: bar\n'), (e) => true);
  });

  it('出现多个含本产品条目的 insert 块', () => {
    const block = renderCairnInsert(SPEC).join('\n');
    const text = '- id: a\n  name: a\n' + block + '\n' + block + '\n';
    assert.throws(() => findCairnInsert(text), forCode('E_CONFIG_CONFLICT'));
    assert.throws(() => upsertCairnInsert(text, SPEC), forCode('E_CONFIG_CONFLICT'));
    assert.throws(() => removeCairnInsert(text), forCode('E_CONFIG_CONFLICT'));
  });

  it('非顶层（缩进）的 insert 块', () => {
    const text = '- id: a\n  name: a\n  config:\n    - insert:\n        - id: x\n';
    assert.throws(() => scanPatchBlocks(text), forCode('E_CONFIG_CONFLICT'));
  });

  it('hasCairnInsert 在结构不符时同样抛出而非返回 false', () => {
    assert.throws(() => hasCairnInsert('foo: bar\n'), (e) => true);
  });
});
