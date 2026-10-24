#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { AppService } from '../app-service.js';
import { CairnError, isCairnError, ExitCode } from '../../core/errors.js';
import { MemoryKind, MEMORY_KINDS } from '../../core/types.js';

/**
 * Cairn MCP stdio 服务器（任务 5.2）：
 * - stdout 只输出 JSON-RPC 协议消息（由 SDK 写入）；一切日志/诊断走 stderr。
 * - 有界本地操作 + 任务入队；退出前不要求完成任何后台任务。
 * - memory_propose 只生成候选；user_confirmed 等声明字段不被信任。
 * - onboarding 工具仅在存在待整理批次时暴露（按需工具面）。
 */

const TOOL_NAMES = [
  'memory_context',
  'memory_search',
  'memory_get',
  'memory_add',
  'memory_propose',
  'memory_update',
  'memory_forget',
  'memory_status',
] as const;

const ONBOARDING_TOOLS = ['onboarding_status', 'onboarding_next_batch', 'onboarding_propose', 'onboarding_apply'] as const;

function toolDef(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
): { name: string; description: string; inputSchema: { type: 'object'; properties: Record<string, unknown>; required: string[] } } {
  return { name, description, inputSchema: { type: 'object', properties, required } };
}

export function createServer(home?: string): Server {
  // MCP 调用方是 Agent 通道：受作用域约束（CLI 是 user 通道，数据主权者）
  process.env['CAIRN_CHANNEL'] = 'agent';
  const service = AppService.open(home);
  const server = new Server(
    { name: 'cairn', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  function onboardingActive(): boolean {
    // 存在已导入未晋升条目时才暴露 onboarding 工具（按需工具面）
    try {
      const d = service.doctor();
      return d.counts.importItems.clean > 0;
    } catch {
      return false;
    }
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = [
      toolDef(
        'memory_context',
        '返回当前上下文可用的启动/任务记忆（按作用域过滤的 active 记忆，含来源与权威级别）。仅在任务确实需要历史偏好、决策和项目事实时调用。',
        {
          query: { type: 'string', description: '可选的主题关键词' },
          limit: { type: 'number', description: '默认 10，上限 50' },
          project_id: { type: 'string' },
        },
        [],
      ),
      toolDef(
        'memory_search',
        '按关键词检索记忆预览（不返回全文上下文注入）。',
        {
          query: { type: 'string' },
          status: { type: 'string', description: '默认 active；candidate/conflicted 需显式' },
          limit: { type: 'number' },
        },
        ['query'],
      ),
      toolDef('memory_get', '读取一条记忆的完整内容、修订历史与证据。', { id: { type: 'string' } }, ['id']),
      toolDef(
        'memory_add',
        '显式新增记忆。只在用户明确要求"记住/更正"时调用；写入内容成为 user_explicit 活动记忆。',
        {
          content: { type: 'string' },
          kind: { type: 'string', enum: [...MEMORY_KINDS] },
          sensitive: { type: 'boolean' },
          scope_preset: { type: 'string', description: '默认 personal-global；device-local/project-global 等' },
          project_id: { type: 'string' },
        },
        ['content'],
      ),
      toolDef(
        'memory_propose',
        '提交模型推断的候选记忆（进入待审查队列，不会直接成为活动记忆，不会覆盖用户明确记忆）。',
        { content: { type: 'string' }, kind: { type: 'string', enum: [...MEMORY_KINDS] } },
        ['content'],
      ),
      toolDef(
        'memory_update',
        '对既有记忆追加新修订（不无痕覆盖历史）。仅当用户明确更正时调用。',
        { id: { type: 'string' }, content: { type: 'string' }, reason: { type: 'string' } },
        ['id', 'content'],
      ),
      toolDef(
        'memory_forget',
        '遗忘一条记忆（生成可审计 tombstone）。仅当用户明确要求遗忘时调用。',
        { id: { type: 'string' }, reason: { type: 'string' } },
        ['id'],
      ),
      toolDef('memory_status', '返回本地库健康摘要：各状态计数、冲突数、待处理任务、设备状态。', {}, []),
    ];
    if (onboardingActive()) {
      tools.push(
        toolDef(
          'onboarding_status',
          '首次初始化：返回当前批次与待整理条目进度。只在用户明确要求初始化记忆时使用。',
          {},
          [],
        ),
        toolDef(
          'onboarding_next_batch',
          '首次初始化：取下一批已授权待整理条目（有界），供生成 add/merge/keep_both/skip 建议。',
          { limit: { type: 'number' } },
          [],
        ),
        toolDef(
          'onboarding_propose',
          '首次初始化：把本批建议（add/merge/keep_both/skip）提交为治理计划。只保存计划，不晋升；等待用户本地审批。',
          {
            batch_id: { type: 'string', description: '默认当前活跃批次' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  content: { type: 'string' },
                  kind: { type: 'string', enum: [...MEMORY_KINDS] },
                  opHint: { type: 'string', description: 'add|merge|keep_both|skip' },
                  targetMemoryId: { type: 'string' },
                  reason: { type: 'string' },
                },
                required: ['content'],
              },
            },
          },
          ['items'],
        ),
        toolDef(
          'onboarding_apply',
          '首次初始化：应用已获本地审批（cairn approve 签发的 approval_id）的治理计划。调用方声明 user_confirmed 无效。',
          { plan_id: { type: 'string' }, approval_id: { type: 'string' } },
          ['plan_id', 'approval_id'],
        ),
      );
    }
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    try {
      const result = await handleTool(service, name, args);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (e) {
      if (isCairnError(e)) {
        // 治理拒绝是正常的工具结果（isError 标记），不是协议错误；细节只含 masked
        return { isError: true, content: [{ type: 'text', text: JSON.stringify(e.toJSON()) }] };
      }
      throw e;
    }
  });

  // 进程退出：不做任何后台等待（design D9）
  const closeService = (): void => {
    try {
      service.close();
    } catch {
      /* 忽略关闭错误 */
    }
  };
  process.on('exit', closeService);
  process.on('SIGINT', () => {
    closeService();
    process.exit(0);
  });

  return server;
}

async function handleTool(service: AppService, name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'memory_context': {
      const query = typeof args['query'] === 'string' ? args['query'] : '';
      const limit = Math.min(Number(args['limit'] ?? 10) || 10, 50);
      if (query) {
        const r = service.search({
          text: query,
          query: { deviceId: service.caller.deviceId, agentId: service.caller.agentId, projectId: (args['project_id'] as string) ?? null },
          limit,
        });
        return {
          why_recalled: 'query_match',
          items: r.results.map((h) => summarize(h.memory, { matchedBy: h.matchedBy })),
        };
      }
      // 无查询：返回最近更新的 active 记忆作为启动层
      const store = service.store;
      const scope = service.resolveScope(undefined);
      const recent = store.memories.list({ scopeId: scope.id, status: 'active', limit });
      return {
        why_recalled: 'recent_active',
        items: recent.map((m) => summarize(m, {})),
      };
    }

    case 'memory_search': {
      const r = service.search({
        text: String(args['query'] ?? ''),
        query: { deviceId: service.caller.deviceId, agentId: service.caller.agentId },
        statuses: args['status'] ? [String(args['status']) as never] : undefined,
        limit: args['limit'] != null ? Number(args['limit']) : undefined,
      });
      return { matchedBy: r.matchedBy, degraded: r.degraded, items: r.results.map((h) => summarize(h.memory, { matchedBy: h.matchedBy, conflictId: h.conflictId, unverifiableImport: h.unverifiableImport })) };
    }

    case 'memory_get': {
      return service.showMemory(String(args['id']));
    }

    case 'memory_add': {
      const m = service.addMemory({
        content: String(args['content'] ?? ''),
        kind: args['kind'] as MemoryKind | undefined,
        sensitivity: args['sensitive'] === true ? 'sensitive' : 'normal',
        scope: {
          preset: args['scope_preset'] as never,
          projectId: args['project_id'] as string | undefined,
        },
      });
      return { id: m.id, status: m.status, authority: m.authority };
    }

    case 'memory_propose': {
      const m = service.proposeCandidate({
        content: String(args['content'] ?? ''),
        kind: args['kind'] as MemoryKind | undefined,
      });
      return { id: m.id, status: m.status, authority: m.authority, note: '候选已保存，等待用户审查；不会自动晋升' };
    }

    case 'memory_update': {
      const r = service.reviseMemory(String(args['id']), String(args['content'] ?? ''), { reason: args['reason'] ? String(args['reason']) : undefined });
      return { id: r.memory.id, revisionId: r.revision.id, status: r.memory.status };
    }

    case 'memory_forget': {
      const m = service.forgetMemory(String(args['id']), args['reason'] ? String(args['reason']) : null);
      return { id: m.id, status: m.status };
    }

    case 'memory_status': {
      return service.status();
    }

    case 'onboarding_status': {
      const batchId = service.activeBatchId();
      if (!batchId) return { activeBatch: null, note: '没有待整理批次' };
      return { ...service.batchStatus(batchId) };
    }

    case 'onboarding_next_batch': {
      const batchId = service.activeBatchId();
      if (!batchId) throw new CairnError('E_VALIDATION', '没有待整理批次；请先通过 CLI 导入来源');
      const limit = Math.min(Number(args['limit'] ?? 10) || 10, 50);
      return { batchId, items: service.batchChunk(batchId, limit) };
    }

    case 'onboarding_propose': {
      const items = (args['items'] as { content: string; kind?: string; opHint?: string; targetMemoryId?: string; reason?: string }[] | undefined) ?? [];
      if (items.length === 0) throw new CairnError('E_VALIDATION', 'items 不能为空：请对批次条目给出 add/merge/keep_both/skip 建议');
      const r = service.proposeForBatch({
        batchId: args['batch_id'] ? String(args['batch_id']) : undefined,
        items: items.map((i) => ({
          content: String(i.content ?? ''),
          kind: i.kind as never,
          opHint: i.opHint as never,
          targetMemoryId: i.targetMemoryId,
          reason: i.reason,
        })),
        proposedBy: `mcp:${service.caller.agentId}`,
      });
      return {
        planId: r.plan.id,
        planHash: r.planHash,
        status: r.plan.status,
        accepted: r.accepted,
        rejected: r.rejected,
        duplicates: r.duplicates,
        note: '计划等待用户在本地 CLI 审批（cairn approve）。批准后才能用 onboarding_apply 应用。',
      };
    }

    case 'onboarding_apply': {
      const planId = String(args['plan_id'] ?? '');
      const approvalId = String(args['approval_id'] ?? '');
      if (!planId || !approvalId) throw new CairnError('E_VALIDATION', '需要 plan_id 与 approval_id（approval 由本地 CLI cairn approve 签发）');
      const r = service.applyPlan(planId, approvalId);
      return { ...r, note: '已按一次性审批应用；调用方声明的 user_confirmed 不构成授权' };
    }

    default:
      throw new CairnError('E_VALIDATION', `未知工具: ${name}`);
  }
}

function summarize(m: { id: string; kind: string; status: string; authority: string; content: string; scopeId: string; updatedAt: string }, extra: { matchedBy?: string; conflictId?: string; unverifiableImport?: boolean }): unknown {
  return {
    id: m.id,
    kind: m.kind,
    status: m.status,
    authority: m.authority,
    scopeId: m.scopeId,
    updated_at: m.updatedAt,
    content: m.content,
    ...(extra.matchedBy ? { matched_by: extra.matchedBy } : {}),
    ...(extra.conflictId ? { conflict_id: extra.conflictId } : {}),
    ...(extra.unverifiableImport ? { unverifiable_import: true } : {}),
  };
}

export async function runMcpServer(home?: string): Promise<void> {
  const server = createServer(home);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[cairn-mcp] stdio server ready (pid ${process.pid})\n`);
  // 保持进程运行直到客户端断开（transport 关闭时 exit 事件触发 service close）
  process.exitCode = ExitCode.success;
}

// 直接执行时启动（被测试导入时不自动执行）；解析 --home 与 CAIRN_HOME
if (process.argv[1] != null && /mcp[\\/]server\.(js|ts)$/.test(process.argv[1].replace(/\\/g, '/'))) {
  const homeIdx = process.argv.indexOf('--home');
  const home = homeIdx > 0 ? process.argv[homeIdx + 1] : undefined;
  void runMcpServer(home);
}
