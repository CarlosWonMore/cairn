/**
 * 元数据发现适配器测试（tasks 4.1）。
 *
 * 关键证据要求：所有 fixture 文件正文只写入唯一金丝雀串
 * 'CAIRN-CANARY-DO-NOT-READ-7f3a'，并对 discoverSources 完整 JSON 序列化
 * 结果断言不含金丝雀——证明发现阶段正文读取为零。
 * 测试本身允许读文件（用于构造 fixture 与金丝雀对照），被测代码不允许。
 */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, open, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { TestContext } from 'node:test';

import { discoverSources } from '../../src/onboarding/discover.js';
import type { SourceCandidate } from '../../src/onboarding/discover.js';
import { isCairnError } from '../../src/core/errors.js';

const CANARY = 'CAIRN-CANARY-DO-NOT-READ-7f3a';
const CANARY_BYTES = Buffer.byteLength(CANARY, 'utf8');

async function putFile(p: string, content: string = CANARY): Promise<void> {
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, content, 'utf8');
}

/** 稀疏文件：不写正文，只占用元数据层面的文件大小。 */
async function putSparse(p: string, bytes: number): Promise<void> {
  await mkdir(path.dirname(p), { recursive: true });
  const fh = await open(p, 'w');
  try {
    await fh.truncate(bytes);
  } finally {
    await fh.close();
  }
}

async function makeBase(t: TestContext): Promise<string> {
  const base = await mkdtemp(path.join(tmpdir(), 'cairn-discover-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  return base;
}

function byPath(results: SourceCandidate[], p: string): SourceCandidate {
  const found = results.find((c) => c.path === p);
  assert.ok(found, `应发现候选来源 ${p}（实际发现：${results.map((c) => c.path).join(' ; ') || '（无）'}）`);
  return found;
}

function forCode(code: 'E_FORBIDDEN' | 'E_VALIDATION') {
  return (e: unknown): boolean => isCairnError(e) && e.code === code;
}

describe('discoverSources（元数据发现适配器，发现阶段零正文读取）', () => {
  let base: string;
  let home: string;
  let projA: string;
  let projEmpty: string;
  let shared: SourceCandidate[];

  before(async () => {
    base = await mkdtemp(path.join(tmpdir(), 'cairn-discover-shared-'));
    home = path.join(base, 'home');
    projA = path.join(base, 'proj-a');
    projEmpty = path.join(base, 'proj-empty');

    // home 级 fixture
    await putFile(path.join(home, '.claude', 'projects', 'alpha-x', 'memory', 'MEMORY.md'));
    await putFile(path.join(home, '.claude', 'projects', 'alpha-x', 'memory', 'topic-testing.md'));
    await putFile(path.join(home, '.claude', 'projects', 'beta-y', 'memory', 'MEMORY.md'));
    await putFile(path.join(home, '.cursor', 'rules', 'backend.mdc'));
    await putFile(path.join(home, '.cursor', 'rules', 'frontend.mdc'));
    await putFile(path.join(home, '.cursor', 'rules', 'notes.txt'), '非 .mdc，忽略');
    await putFile(path.join(home, '.openclaw', 'workspace', 'USER.md'));
    await putFile(path.join(home, '.openclaw', 'workspace', 'MEMORY.md'));
    await putFile(path.join(home, '.openclaw', 'workspace', 'memory', '2026-10-24.md'));
    await putFile(path.join(home, '.workbuddy', 'exports', 'memory-export.md'));
    await putFile(path.join(home, 'AGENTS.md'), 'home 层 AGENTS.md：只有显式传入 projectRoots 才被发现');

    // 项目根 fixture
    await putFile(path.join(projA, '.github', 'copilot-instructions.md'));
    await putFile(path.join(projA, '.github', 'instructions', 'typescript.instructions.md'));
    await putFile(path.join(projA, '.github', 'instructions', 'python.instructions.md'));
    await putFile(path.join(projA, '.github', 'instructions', 'readme.md'), '不带 .instructions.md 后缀，忽略');
    await putFile(path.join(projA, 'AGENTS.md'));
    await putFile(path.join(projA, '.cursor', 'rules', 'proj-rule.mdc'));
    await putFile(path.join(projA, '.cursor', 'rules', 'nested', 'deep.mdc'), '子目录不展开');

    await mkdir(projEmpty, { recursive: true });

    shared = await discoverSources({ homeDir: home, projectRoots: [projA, projEmpty] });
  });

  after(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('claude-code：MEMORY.md 与主题目录候选的元数据正确', () => {
    const memoryDir = path.join(home, '.claude', 'projects', 'alpha-x', 'memory');
    const index = byPath(shared, path.join(memoryDir, 'MEMORY.md'));
    assert.equal(index.agentKind, 'claude-code');
    assert.equal(index.sourceKind, 'memory');
    assert.equal(index.parser, 'markdown-memory-index');
    assert.equal(index.fileCount, 1);
    assert.equal(index.byteSize, CANARY_BYTES);
    assert.ok(!('skippedNotes' in index), '无跳过时不应携带 skippedNotes 字段');

    const topics = byPath(shared, memoryDir);
    assert.equal(topics.parser, 'markdown-topics');
    assert.equal(topics.sourceKind, 'memory');
    assert.equal(topics.fileCount, 1, '主题目录只含 topic-testing.md（MEMORY.md 另列）');
    assert.equal(topics.byteSize, CANARY_BYTES);

    // beta-y 只有 MEMORY.md：不应产生空的主题目录候选
    const betaDir = path.join(home, '.claude', 'projects', 'beta-y', 'memory');
    assert.ok(!shared.some((c) => c.path === betaDir), '无主题文件时不应产生空主题候选');
    byPath(shared, path.join(betaDir, 'MEMORY.md'));
    assert.equal(shared.filter((c) => c.agentKind === 'claude-code').length, 3);
    // 首版不扫描任何层级的 CLAUDE.md
    assert.ok(!shared.some((c) => c.path.endsWith('CLAUDE.md')), 'CLAUDE.md 不在扫描范围');
  });

  it('cursor：home 层 .cursor/rules 聚合目录候选，只收顶层 .mdc', () => {
    const rules = byPath(shared, path.join(home, '.cursor', 'rules'));
    assert.equal(rules.agentKind, 'cursor');
    assert.equal(rules.sourceKind, 'rules');
    assert.equal(rules.parser, 'mdc-rules');
    assert.equal(rules.fileCount, 2, 'notes.txt 等非 .mdc 不计入');
    assert.equal(rules.byteSize, CANARY_BYTES * 2);
  });

  it('copilot：项目根 copilot-instructions.md 与 instructions 目录', () => {
    const single = byPath(shared, path.join(projA, '.github', 'copilot-instructions.md'));
    assert.equal(single.agentKind, 'copilot');
    assert.equal(single.sourceKind, 'rules');
    assert.equal(single.parser, 'markdown-instructions');
    assert.equal(single.fileCount, 1);
    assert.equal(single.byteSize, CANARY_BYTES);

    const dir = byPath(shared, path.join(projA, '.github', 'instructions'));
    assert.equal(dir.parser, 'markdown-instructions');
    assert.equal(dir.fileCount, 2, 'readme.md 不带 .instructions.md 后缀，忽略');
    assert.equal(dir.byteSize, CANARY_BYTES * 2);
  });

  it('AGENTS.md：仅项目根顶层发现，parser markdown-workspace；home 层不自动扫描', () => {
    const agents = byPath(shared, path.join(projA, 'AGENTS.md'));
    assert.equal(agents.agentKind, 'copilot');
    assert.equal(agents.sourceKind, 'rules');
    assert.equal(agents.parser, 'markdown-workspace');
    assert.equal(agents.fileCount, 1);
    assert.ok(!shared.some((c) => c.path === path.join(home, 'AGENTS.md')), 'homeDir 不自动当作项目根');
  });

  it('cursor：项目根 .cursor/rules，子目录不展开', () => {
    const rules = byPath(shared, path.join(projA, '.cursor', 'rules'));
    assert.equal(rules.agentKind, 'cursor');
    assert.equal(rules.parser, 'mdc-rules');
    assert.equal(rules.fileCount, 1, 'nested/deep.mdc 不计入（仅顶层）');
    assert.equal(rules.byteSize, CANARY_BYTES);
  });

  it('openclaw：USER.md / MEMORY.md / 每日记忆目录', () => {
    const user = byPath(shared, path.join(home, '.openclaw', 'workspace', 'USER.md'));
    assert.equal(user.agentKind, 'openclaw');
    assert.equal(user.sourceKind, 'memory');
    assert.equal(user.parser, 'markdown-user-profile');
    assert.equal(user.fileCount, 1);

    const memory = byPath(shared, path.join(home, '.openclaw', 'workspace', 'MEMORY.md'));
    assert.equal(memory.parser, 'markdown-memory-index');
    assert.equal(memory.fileCount, 1);

    const daily = byPath(shared, path.join(home, '.openclaw', 'workspace', 'memory'));
    assert.equal(daily.parser, 'markdown-daily');
    assert.equal(daily.fileCount, 1);
    assert.equal(daily.byteSize, CANARY_BYTES);
  });

  it('workbuddy：手动导出存档，parser markdown-export；MCP 配置路径不列入', () => {
    const exported = byPath(shared, path.join(home, '.workbuddy', 'exports', 'memory-export.md'));
    assert.equal(exported.agentKind, 'workbuddy');
    assert.equal(exported.sourceKind, 'memory');
    assert.equal(exported.parser, 'markdown-export');
    assert.equal(exported.fileCount, 1);
    assert.ok(exported.capabilityNote.includes('手动导出'), '能力说明应标注手动导出边界');
    assert.ok(exported.capabilityNote.includes('MCP'), '能力说明应声明 MCP 配置路径未公开不列入');
  });

  it('排序确定性：按 (agentKind, path) 升序，重复调用结果一致', async () => {
    const expectedOrder = [
      path.join(home, '.claude', 'projects', 'alpha-x', 'memory'),
      path.join(home, '.claude', 'projects', 'alpha-x', 'memory', 'MEMORY.md'),
      path.join(home, '.claude', 'projects', 'beta-y', 'memory', 'MEMORY.md'),
      path.join(projA, '.github', 'copilot-instructions.md'),
      path.join(projA, '.github', 'instructions'),
      path.join(projA, 'AGENTS.md'),
      path.join(home, '.cursor', 'rules'),
      path.join(projA, '.cursor', 'rules'),
      path.join(home, '.openclaw', 'workspace', 'MEMORY.md'),
      path.join(home, '.openclaw', 'workspace', 'USER.md'),
      path.join(home, '.openclaw', 'workspace', 'memory'),
      path.join(home, '.workbuddy', 'exports', 'memory-export.md'),
    ];
    assert.deepEqual(
      shared.map((c) => c.path),
      expectedOrder,
      '候选必须按 (agentKind, path) 确定排序',
    );
    const again = await discoverSources({ homeDir: home, projectRoots: [projA, projEmpty] });
    assert.deepEqual(again, shared, '同一文件系统状态下重复发现结果必须一致');
  });

  it('零正文读取：金丝雀不出现在发现结果的任何字段', async () => {
    // 对照组：fixture 本体确实携带金丝雀（若发现泄漏正文，下方断言必然失败）
    const raw = await readFile(path.join(home, '.workbuddy', 'exports', 'memory-export.md'), 'utf8');
    assert.ok(raw.includes(CANARY), '前置条件：fixture 文件正文含金丝雀');
    const json = JSON.stringify(shared);
    assert.ok(!json.includes(CANARY), '发现结果（含所有字段）不得包含任何文件正文片段');
  });

  it('结构契约：路径均为绝对路径，capabilityNote 为非空中文说明，无非法数值', () => {
    assert.ok(shared.length > 0);
    for (const c of shared) {
      assert.ok(path.isAbsolute(c.path), `候选路径应为绝对路径：${c.path}`);
      assert.equal(typeof c.capabilityNote, 'string');
      assert.ok(c.capabilityNote.length > 0, '每个候选都要有能力边界说明');
      assert.ok(c.fileCount >= 0 && Number.isInteger(c.fileCount));
      assert.ok(c.byteSize >= 0 && Number.isInteger(c.byteSize));
      assert.ok(['memory', 'rules'].includes(c.sourceKind));
    }
    // 同一路径不得重复出现
    const paths = new Set(shared.map((c) => c.path));
    assert.equal(paths.size, shared.length, '候选路径不得重复');
  });

  it('空目录 homeDir → 空数组', async (t) => {
    const b = await makeBase(t);
    assert.deepEqual(await discoverSources({ homeDir: b }), []);
  });

  it('不存在的 homeDir → 空数组而不是抛错', async (t) => {
    const b = await makeBase(t);
    assert.deepEqual(await discoverSources({ homeDir: path.join(b, 'no-such-home') }), []);
  });

  it('homeDir 传文件而非目录 → 空数组', async (t) => {
    const b = await makeBase(t);
    const file = path.join(b, 'a-file');
    await putFile(file, 'x');
    assert.deepEqual(await discoverSources({ homeDir: file }), []);
  });

  it('projectRoots 缺省时不产生项目级来源', async () => {
    const results = await discoverSources({ homeDir: home });
    assert.equal(results.length, 8, '只含 home 级来源：3 claude + 1 cursor + 3 openclaw + 1 workbuddy');
    assert.ok(!results.some((c) => c.agentKind === 'copilot'), '无项目根则无 copilot/AGENTS.md 来源');
    assert.ok(results.every((c) => c.path.startsWith(home)), '所有候选都来自 home 层');
  });

  it('不存在的 projectRoot 与空项目根被静默忽略', async () => {
    const results = await discoverSources({ homeDir: home, projectRoots: [path.join(base, 'nope'), projEmpty] });
    assert.equal(results.length, 8);
    assert.ok(!results.some((c) => c.path.startsWith(projEmpty)), '空项目根不产生候选');
  });

  it('homeDir 可作为项目根显式传入 projectRoots', async () => {
    const results = await discoverSources({ homeDir: home, projectRoots: [home] });
    const agents = byPath(results, path.join(home, 'AGENTS.md'));
    assert.equal(agents.parser, 'markdown-workspace');
  });

  it('UNC homeDir 直接抛 E_FORBIDDEN，不发起任何访问', async () => {
    await assert.rejects(discoverSources({ homeDir: '\\\\server\\share\\home' }), forCode('E_FORBIDDEN'));
    await assert.rejects(discoverSources({ homeDir: '\\\\?\\C:\\temp\\x' }), forCode('E_FORBIDDEN'));
  });

  it('UNC projectRoot 直接抛 E_FORBIDDEN；// 前缀同样拒绝', async () => {
    await assert.rejects(
      discoverSources({ homeDir: home, projectRoots: ['\\\\srv\\share'] }),
      forCode('E_FORBIDDEN'),
    );
    await assert.rejects(discoverSources({ homeDir: home, projectRoots: ['//server/share'] }), forCode('E_FORBIDDEN'));
  });

  it('homeDir/projectRoots 空字符串 → E_VALIDATION', async () => {
    await assert.rejects(discoverSources({ homeDir: '' }), forCode('E_VALIDATION'));
    await assert.rejects(discoverSources({ homeDir: home, projectRoots: [''] }), forCode('E_VALIDATION'));
  });

  it('maxFiles / maxFileBytes 非法值 → E_VALIDATION', async () => {
    await assert.rejects(discoverSources({ homeDir: home, maxFiles: 0 }), forCode('E_VALIDATION'));
    await assert.rejects(discoverSources({ homeDir: home, maxFiles: 2.5 }), forCode('E_VALIDATION'));
    await assert.rejects(discoverSources({ homeDir: home, maxFileBytes: 0 }), forCode('E_VALIDATION'));
  });

  it('符号链接（目录类来源内）：不出现在结果、skippedNotes 有记录、不跟随目标', async (t) => {
    const b = await makeBase(t);
    const homeDir = path.join(b, 'home');
    const memoryDir = path.join(homeDir, '.claude', 'projects', 'alpha-x', 'memory');
    const outside = path.join(b, 'outside-secret.md');
    const linkPath = path.join(memoryDir, 'topic-linked.md');
    await putFile(path.join(memoryDir, 'MEMORY.md'));
    await putFile(path.join(memoryDir, 'topic-real.md'));
    await putFile(outside, CANARY);
    try {
      await symlink(outside, linkPath, 'file');
    } catch {
      t.skip('当前环境不允许创建文件符号链接（Windows 需管理员或开发者模式）');
      return;
    }
    const results = await discoverSources({ homeDir });
    assert.ok(!results.some((c) => c.path === linkPath), '符号链接不得作为候选出现');
    const topics = byPath(results, memoryDir);
    assert.equal(topics.fileCount, 1, '只计入真实文件 topic-real.md');
    assert.ok(
      topics.skippedNotes?.some((n) => n.includes('symlink') && n.includes('topic-linked.md')),
      'skippedNotes 必须记录被跳过的符号链接',
    );
    const json = JSON.stringify(results);
    assert.ok(!json.includes(CANARY), '未跟随符号链接读取外部正文');
    assert.ok(!json.includes('outside-secret.md'), '结果中不得出现符号链接目标路径（未跟随）');
  });

  it('符号链接（单文件来源）：fileCount 0 + skippedNotes，不产生可快照来源', async (t) => {
    const b = await makeBase(t);
    const homeDir = path.join(b, 'home');
    const linkPath = path.join(homeDir, '.workbuddy', 'exports', 'memory-export.md');
    const outside = path.join(b, 'outside-secret.md');
    await mkdir(path.dirname(linkPath), { recursive: true });
    await putFile(outside, CANARY);
    try {
      await symlink(outside, linkPath, 'file');
    } catch {
      t.skip('当前环境不允许创建文件符号链接（Windows 需管理员或开发者模式）');
      return;
    }
    const results = await discoverSources({ homeDir });
    assert.equal(results.length, 1);
    assert.equal(results[0]?.path, linkPath);
    assert.equal(results[0]?.fileCount, 0, '符号链接不可快照，fileCount 为 0');
    assert.equal(results[0]?.byteSize, 0);
    assert.equal(results[0]?.parser, 'markdown-export');
    assert.ok(results[0]?.skippedNotes?.some((n) => n.includes('symlink')));
    assert.ok(!JSON.stringify(results).includes(CANARY));
  });

  it('超大文件（目录类来源内）：跳过并记 oversized，正常文件不受影响', async (t) => {
    const b = await makeBase(t);
    const homeDir = path.join(b, 'home');
    const rulesDir = path.join(homeDir, '.cursor', 'rules');
    await putFile(path.join(rulesDir, 'small.mdc'));
    await putSparse(path.join(rulesDir, 'big.mdc'), 4096);
    const results = await discoverSources({ homeDir, maxFileBytes: 1024 });
    const rules = byPath(results, rulesDir);
    assert.equal(rules.fileCount, 1, '超限文件不计入 fileCount');
    assert.equal(rules.byteSize, CANARY_BYTES, '超限文件不计入 byteSize');
    assert.ok(
      rules.skippedNotes?.some((n) => n.includes('oversized') && n.includes('big.mdc') && n.includes('4096')),
      'skippedNotes 必须记录 oversized 跳过原因与实际大小',
    );
  });

  it('超大单文件来源：fileCount 0 + oversized 说明，byteSize 不冒充可读正文', async (t) => {
    const b = await makeBase(t);
    const homeDir = path.join(b, 'home');
    await putSparse(path.join(homeDir, '.workbuddy', 'exports', 'memory-export.md'), 4096);
    const results = await discoverSources({ homeDir, maxFileBytes: 1024 });
    assert.equal(results.length, 1);
    assert.equal(results[0]?.fileCount, 0);
    assert.equal(results[0]?.byteSize, 0, '被跳过的来源不报告可快照字节量');
    assert.ok(results[0]?.skippedNotes?.some((n) => n.includes('oversized') && n.includes('4096')));
  });

  it('默认 maxFileBytes（10 MiB）生效', async (t) => {
    const b = await makeBase(t);
    const homeDir = path.join(b, 'home');
    await putSparse(path.join(homeDir, '.cursor', 'rules', 'huge.mdc'), 11 * 1024 * 1024);
    const results = await discoverSources({ homeDir });
    const rules = byPath(results, path.join(homeDir, '.cursor', 'rules'));
    assert.equal(rules.fileCount, 0);
    assert.ok(rules.skippedNotes?.some((n) => n.includes('oversized')));
  });

  it('maxFiles 先到先停并在候选上注明剩余数量', async (t) => {
    const b = await makeBase(t);
    const homeDir = path.join(b, 'home');
    const rulesDir = path.join(homeDir, '.cursor', 'rules');
    for (const name of ['r1.mdc', 'r2.mdc', 'r3.mdc', 'r4.mdc', 'r5.mdc']) {
      await putFile(path.join(rulesDir, name));
    }
    const results = await discoverSources({ homeDir, maxFiles: 3 });
    assert.equal(results.length, 1);
    const rules = results[0];
    assert.equal(rules?.fileCount, 3, '只列入前 3 个（按名称排序先到先得）');
    const total = results.reduce((sum, c) => sum + c.fileCount, 0);
    assert.ok(total <= 3, '全局文件数不得超上限');
    assert.ok(
      rules?.skippedNotes?.some((n) => n.includes('maxFiles') && n.includes('2')),
      '应注明剩余 2 个候选文件未列入',
    );
  });

  it('maxFiles 恰好用尽且无剩余时不产生误报说明', async (t) => {
    const b = await makeBase(t);
    const homeDir = path.join(b, 'home');
    const rulesDir = path.join(homeDir, '.cursor', 'rules');
    for (const name of ['r1.mdc', 'r2.mdc', 'r3.mdc']) {
      await putFile(path.join(rulesDir, name));
    }
    const results = await discoverSources({ homeDir, maxFiles: 3 });
    assert.equal(results.length, 1);
    assert.equal(results[0]?.fileCount, 3);
    assert.ok(!('skippedNotes' in (results[0] as SourceCandidate)), '恰好用尽且无截断时不应有 maxFiles 说明');
  });

  it('maxFiles 耗尽后后续来源位置停止扫描', async (t) => {
    const b = await makeBase(t);
    const homeDir = path.join(b, 'home');
    const rulesDir = path.join(homeDir, '.cursor', 'rules');
    await putFile(path.join(rulesDir, 'a.mdc'));
    await putFile(path.join(rulesDir, 'b.mdc'));
    await putFile(path.join(homeDir, '.workbuddy', 'exports', 'memory-export.md'));
    const results = await discoverSources({ homeDir, maxFiles: 1 });
    assert.equal(results.length, 1, '预算耗尽后 workbuddy 等后续来源不再列入');
    assert.equal(results[0]?.path, rulesDir);
    assert.equal(results[0]?.fileCount, 1);
    assert.ok(results[0]?.skippedNotes?.some((n) => n.includes('maxFiles')), '停止扫描必须注明');
  });

  it('同一 projectRoot 重复（含大小写变体）传入会去重', async () => {
    const results = await discoverSources({ homeDir: home, projectRoots: [projA, projA.toUpperCase()] });
    const agentsHits = results.filter((c) => c.path === path.join(projA, 'AGENTS.md'));
    assert.equal(agentsHits.length, 1, '同一项目根只发现一次');
  });
});
