/**
 * 操作审计（add-operation-audit）：service 层。
 *
 * 锁死四条：检索/读取留痕且零内容泄露、总开关生效、FAIL-OPEN（审计坏不影响
 * 业务）、治理类目不受开关影响。全部在合成 HOME 上运行。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AppService } from '../../src/interfaces/app-service.js';
import { makeTestHome, cleanupTestHome } from '../helpers.js';

const SENSITIVE = '机密口令-阿尔法-7788';

function withService(fn: (service: AppService, home: string) => void, env: Record<string, string> = {}): void {
  const home = makeTestHome();
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    prev[k] = process.env[k];
    process.env[k] = v;
  }
  const service = AppService.open(home);
  try {
    fn(service, home);
  } finally {
    service.close();
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    cleanupTestHome(home);
  }
}

test('操作审计：search 留痕（candidates/matchedBy/ms），查询原文与正文零出现', () => {
  withService((service) => {
    service.addMemory({ content: `普通记忆：投影预算 ${SENSITIVE}`, kind: 'fact', sensitivity: 'sensitive', scope: { preset: 'device-local' } });
    const r = service.search({ text: '投影预算', query: { deviceId: service.caller.deviceId, agentId: 'test-agent' } });
    const ops = service.auditList({ category: 'operation' });
    assert.equal(ops.length, 1, '一次 search 一条 operation');
    const detail = ops[0]!.detail as Record<string, unknown>;
    assert.equal(detail['action'] ?? ops[0]!.action, 'memory_search');
    assert.equal(detail['candidates'], r.results.length);
    assert.equal(typeof detail['ms'], 'number');
    assert.ok('matchedBy' in detail);
    // 摘要纪律：整库审计行里不存在查询原文与敏感正文
    const all = JSON.stringify(service.auditList({}));
    assert.ok(!all.includes('投影预算'), '查询原文不得入审计');
    assert.ok(!all.includes(SENSITIVE), '敏感正文不得入审计');
  });
});

test('操作审计：showMemory 留痕（subject=记忆 id）', () => {
  withService((service) => {
    const added = service.addMemory({ content: '用于 get 留痕的记忆', kind: 'fact', scope: { preset: 'personal-global' } });
    const id = (added as { memory?: { id: string } }).memory?.id ?? (added as { id?: string }).id;
    assert.ok(typeof id === 'string', `add 返回形状: ${JSON.stringify(added).slice(0, 120)}`);
    service.showMemory(id as string);
    const gets = service.auditList({ action: 'memory_get' });
    assert.equal(gets.length, 1);
    assert.equal(gets[0]!.subjectId, id);
    const all = JSON.stringify(service.auditList({}));
    assert.ok(!all.includes('用于 get 留痕的记忆'), '记忆正文不得入审计');
  });
});

test('操作审计：audit.operations=false 停写 operation，治理审计照常', () => {
  withService((service) => {
    service.addMemory({ content: '开关关闭期的写入', kind: 'fact', scope: { preset: 'personal-global' } });
    service.search({ text: '什么都没有', query: { deviceId: service.caller.deviceId, agentId: 'a' } });
    assert.equal(service.auditList({ category: 'operation' }).length, 0, '开关关闭不得有 operation 行');
    assert.ok(service.auditList({ category: 'memory' }).length >= 1, '治理/写入审计不受开关影响');
  }, { CAIRN_AUDIT_OPERATIONS: 'false' });
});

test('操作审计：FAIL-OPEN——审计写入抛错不影响检索结果', () => {
  withService((service) => {
    // 模拟审计层损坏：record 直接抛
    (service.store.audit as unknown as { record: () => never }).record = () => {
      throw new Error('audit table corrupted');
    };
    const r = service.search({ text: '任意内容', query: { deviceId: service.caller.deviceId, agentId: 'a' } });
    assert.ok(Array.isArray(r.results), '检索正常返回');
  });
});

test('操作审计：auditList 跨类目可查（memory 写入类目可见）', () => {
  withService((service) => {
    service.addMemory({ content: '跨类目可见性检查', kind: 'fact', scope: { preset: 'personal-global' } });
    const memoryRows = service.auditList({ category: 'memory' });
    assert.ok(memoryRows.length >= 1, '写入操作沿用既有 memory 类目');
    const everything = service.auditList({});
    assert.ok(everything.length >= memoryRows.length, '无过滤时返回全部类目');
  });
});
