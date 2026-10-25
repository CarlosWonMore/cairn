#!/usr/bin/env node
import { AppService, ExitCode } from '../app-service.js';
import { CairnError, isCairnError } from '../../core/errors.js';
import { HOST_ADAPTERS, AgentKind } from '../../agents/adapters.js';
import {
  planAgentConfig,
  applyAgentConfig,
  planSignature,
  doctorAgentConfig,
  uninstallAgentConfig,
  ConfigMode,
} from '../../agents/config.js';
import { backupDatabase, restoreFromBackup } from '../../store/backup.js';
import { join } from 'node:path';

/**
 * Cairn CLI（任务 5.1）：本地初始化、显式记忆管理、检索、导出、
 * 配置计划、健康检查、worker 与卸载入口。
 * stdout 只输出结果（--json 时为机器可读 JSON）；诊断一律 stderr。
 */

interface Flags {
  [k: string]: string | boolean | undefined;
}

/** 取值型标志；其余 --flag 一律按布尔处理，避免吞掉位置参数。 */
const VALUE_FLAGS = new Set([
  'home', 'kind', 'scope', 'scope-id', 'project', 'project-name', 'agent', 'agent-id', 'ttl-days',
  'expires', 'status', 'limit', 'out', 'format', 'reason', 'host', 'home-root', 'project-root',
  'mode', 'plan-file', 'mcp-command', 'mcp-args', 'max', 'expected-revision', 'approval', 'ttl',
  'home-dir', 'agent-kind', 'source-kind', 'proposed-by', 'items-file', 'batch', 'provider',
  'endpoint', 'bucket', 'prefix', 'base-url', 'recovery-file',
]);

function parseArgs(argv: string[]): { flags: Flags; positional: string[] } {
  const flags: Flags = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const key = a.slice(2);
        if (VALUE_FLAGS.has(key)) {
          const next = argv[i + 1];
          if (next != null && !next.startsWith('--')) {
            flags[key] = next;
            i++;
          } else {
            flags[key] = true;
          }
        } else {
          flags[key] = true;
        }
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

function throwUsage(message: string): string {
  throw new CairnError('E_VALIDATION', message);
}

function str(flags: Flags, key: string): string | undefined {
  const v = flags[key];
  return typeof v === 'string' ? v : undefined;
}

function out(payload: unknown, flags: Flags): void {
  if (flags['json']) {
    console.log(JSON.stringify(payload, null, 2));
  } else if (typeof payload === 'string') {
    console.log(payload);
  } else {
    console.log(JSON.stringify(payload, null, 2));
  }
}

function diag(message: string): void {
  process.stderr.write(`[cairn] ${message}\n`);
}

function scopeSelectionFrom(flags: Flags): import('../app-service.js').ScopeSelection | undefined {
  const preset = str(flags, 'scope') as import('../app-service.js').ScopeSelection['preset'] | undefined;
  if (!preset && !str(flags, 'scope-id')) return undefined;
  return {
    preset,
    scopeId: str(flags, 'scope-id'),
    projectId: str(flags, 'project'),
    projectName: str(flags, 'project-name'),
    agentId: str(flags, 'agent'),
    ttlDays: flags['ttl-days'] != null ? Number(flags['ttl-days']) : undefined,
  };
}

const AGENT_KINDS = Object.keys(HOST_ADAPTERS) as AgentKind[];

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const { flags, positional } = parseArgs(argv);
  const command = positional[0] ?? 'help';
  const args = positional.slice(1);
  const home = str(flags, 'home');
  if (str(flags, 'agent-id')) {
    process.env['CAIRN_AGENT_ID'] = str(flags, 'agent-id');
  }

  const json = flags['json'] === true;

  // 不需要打开 store 的命令
  if (command === 'help' || flags['help'] === true) {
    out(HELP, flags);
    return;
  }

  const service = AppService.open(home);
  try {
    switch (command) {
      case 'init': {
        const d = service.doctor();
        out({ initialized: true, home: d.home, device: d.device.id, schemaVersion: d.schemaVersion, problems: d.problems }, flags);
        diag('数据目录就绪。下一步：cairn add "..." 或 cairn discover 查看可导入来源。');
        break;
      }

      case 'add': {
        const content = args.join(' ');
        if (!content) throw new CairnError('E_VALIDATION', '用法: cairn add "内容" [--kind fact] [--scope personal-global|project-global|device-local|project-device|agent-private|session-ephemeral]');
        const m = service.addMemory({
          content,
          kind: str(flags, 'kind') as never,
          sensitivity: flags['sensitive'] === true ? 'sensitive' : 'normal',
          expiresAt: str(flags, 'expires') ?? null,
          scope: scopeSelectionFrom(flags),
        });
        out({ id: m.id, status: m.status, authority: m.authority, kind: m.kind, scopeId: m.scopeId }, flags);
        break;
      }

      case 'search': {
        const text = args.join(' ');
        if (!text) throw new CairnError('E_VALIDATION', '用法: cairn search "关键词"');
        const includeExpired = flags['include-expired'] === true;
        const statuses = str(flags, 'status') ? [str(flags, 'status') as never] : undefined;
        const scopeId = str(flags, 'scope-id');
        const r = service.search({
          text,
          query: { deviceId: service.caller.deviceId, agentId: service.caller.agentId, projectId: str(flags, 'project') ?? null },
          scopeIds: scopeId ? [scopeId] : undefined,
          statuses,
          includeExpired,
          limit: flags['limit'] != null ? Number(flags['limit']) : undefined,
        });
        if (json) {
          out(r, flags);
        } else {
          diag(`matchedBy=${r.matchedBy}${r.degraded ? ' (degraded)' : ''} 共 ${r.results.length} 条`);
          for (const hit of r.results) {
            const tags = [
              hit.memory.status,
              hit.memory.authority,
              hit.unverifiableImport ? 'imported_unverified' : null,
              hit.expired ? 'expired' : null,
              hit.conflictId ? `conflict:${hit.conflictId.slice(0, 8)}` : null,
            ].filter(Boolean).join(',');
            console.log(`- [${hit.memory.id.slice(0, 8)}] (${tags}) ${hit.memory.content.slice(0, 120)}`);
          }
        }
        break;
      }

      case 'show': {
        if (!args[0]) throw new CairnError('E_VALIDATION', '用法: cairn show <id>');
        out(service.showMemory(args[0]!), flags);
        break;
      }

      case 'forget': {
        if (!args[0]) throw new CairnError('E_VALIDATION', '用法: cairn forget <id> [--reason "..."]');
        const m = service.forgetMemory(args[0]!, str(flags, 'reason') ?? null);
        out({ id: m.id, status: m.status }, flags);
        break;
      }

      case 'archive': {
        if (!args[0]) throw new CairnError('E_VALIDATION', '用法: cairn archive <id>');
        const m = service.archiveMemory(args[0]!);
        out({ id: m.id, status: m.status }, flags);
        break;
      }

      case 'update': {
        const id = args[0];
        const content = args.slice(1).join(' ');
        if (!id || !content) throw new CairnError('E_VALIDATION', '用法: cairn update <id> "新内容"');
        const r = service.reviseMemory(id, content, { reason: str(flags, 'reason'), expectedCurrentRevisionId: str(flags, 'expected-revision') });
        out({ id: r.memory.id, revisionId: r.revision.id, seq: r.revision.seq, status: r.memory.status }, flags);
        break;
      }

      case 'export': {
        const r = service.export({
          query: { deviceId: service.caller.deviceId, agentId: service.caller.agentId, projectId: str(flags, 'project') ?? null },
          scopeIds: str(flags, 'scope-id') ? [str(flags, 'scope-id')!] : undefined,
          format: (str(flags, 'format') as 'json' | 'markdown') ?? 'json',
          includeArchives: flags['include-archives'] === true,
        });
        const outFile = str(flags, 'out');
        if (outFile) {
          const { writeFileSync } = await import('node:fs');
          writeFileSync(outFile, r.payload, 'utf8');
          out({ written: outFile, counts: r.counts }, flags);
        } else if (json) {
          // payload 本身就是文档文本；--json 下原样输出（避免双重编码）
          console.log(r.payload);
        } else {
          out(r.payload, flags);
        }
        break;
      }

      case 'backup': {
        const target = str(flags, 'out') ?? join(service.store.paths.backupsDir, `cairn-backup-${Date.now()}.db`);
        const b = backupDatabase(service.store.db, target);
        out(b, flags);
        break;
      }

      case 'restore': {
        const backupPath = args[0];
        if (!backupPath) throw new CairnError('E_VALIDATION', '用法: cairn restore <backup.db> [--home <dir>]');
        service.close();
        const { resolvePaths } = await import('../../store/open.js');
        const paths = resolvePaths(home ?? (process.env['CAIRN_HOME'] ?? ''));
        restoreFromBackup(backupPath, paths.dbPath);
        out({ restored: true, dbPath: paths.dbPath }, flags);
        return;
      }

      case 'doctor': {
        const d = service.doctor();
        if (str(flags, 'host')) {
          const agentKind = str(flags, 'host') as AgentKind;
          const dr = await doctorAgentConfig(service.store, {
            agentKind,
            homeRoot: str(flags, 'home-root') ?? home ?? service.store.paths.home,
            projectRoot: str(flags, 'project-root') ?? process.cwd(),
          });
          out({ ...d, agent: dr }, flags);
        } else {
          out(d, flags);
        }
        break;
      }

      case 'worker': {
        const sub = args[0] ?? 'run-once';
        if (sub !== 'run-once') throw new CairnError('E_VALIDATION', '用法: cairn worker run-once [--max N]');
        const s = await service.workerRunOnce({ max: flags['max'] != null ? Number(flags['max']) : undefined });
        out(s, flags);
        break;
      }

      case 'status': {
        out(service.status(), flags);
        break;
      }

      case 'vault': {
        const sub = args[0];
        if (sub === 'init-remote') {
          const provider = str(flags, 'provider') as 'obs' | 'syncd' | undefined;
          if (provider !== 'obs' && provider !== 'syncd') throw new CairnError('E_VALIDATION', '用法: cairn vault init-remote --provider obs|syncd [--endpoint URL --bucket B --prefix cairn/] [--base-url URL]');
          const r = service.vaultInitRemote({
            provider,
            obs: provider === 'obs' ? {
              endpoint: str(flags, 'endpoint') ?? 'https://obs.cn-east-3.myhuaweicloud.com',
              bucket: str(flags, 'bucket') ?? throwUsage('--bucket 必填'),
              prefix: str(flags, 'prefix') ?? 'cairn/',
            } : undefined,
            syncd: provider === 'syncd' ? { baseUrl: str(flags, 'base-url') ?? throwUsage('--base-url 必填') } : undefined,
          });
          out({ vaultId: r.vault!.vaultId, provider: r.vault!.provider, recovery: r.recovery, warning: '恢复材料请抄写到安全位置；密钥丢失 = 云端数据不可恢复' }, flags);
        } else if (sub === 'status') {
          out(service.vaultStatus(), flags);
        } else if (sub === 'import-key') {
          const file = str(flags, 'recovery-file');
          if (!file) throw new CairnError('E_VALIDATION', '用法: cairn vault import-key --recovery-file <material.txt>');
          const { readFileSync } = await import('node:fs');
          service.vaultImportKey(readFileSync(file, 'utf8').trim());
          out({ imported: true }, flags);
        } else if (sub === 'export-key') {
          const recovery = service.vaultExportKey();
          out({ recovery, warning: '不要提交到任何仓库或发送给他人；密钥丢失 = 云端数据不可恢复' }, flags);
        } else {
          throw new CairnError('E_VALIDATION', '用法: cairn vault init-remote|status|export-key');
        }
        break;
      }

      case 'sync': {
        const sub = args[0];
        if (sub === 'push') {
          const r = await service.syncPushCmd();
          out(r ?? { pushed: false, note: '没有待上行任务' }, flags);
        } else if (sub === 'pull') {
          out(await service.syncPullCmd(), flags);
        } else {
          throw new CairnError('E_VALIDATION', '用法: cairn sync push|pull');
        }
        break;
      }

      case 'device': {
        const sub = args[0] ?? 'status';
        if (sub === 're-enroll') {
          const r = service.store.reEnroll();
          out({ newDeviceId: r.identity.deviceId, oldDeviceId: r.old.deviceId, note: '旧身份已暂停；新身份已注册并恢复写入' }, flags);
        } else if (sub === 'status') {
          out({ deviceId: service.store.identity.deviceId, ...service.store.cloneCheck }, flags);
        } else {
          throw new CairnError('E_VALIDATION', '用法: cairn device status | device re-enroll');
        }
        break;
      }

      case 'agent': {
        const sub = args[0];
        const agentKind = str(flags, 'host') as AgentKind | undefined;
        if (sub === 'apply') {
          const planFile = str(flags, 'plan-file');
          if (!planFile) throw new CairnError('E_VALIDATION', '用法: cairn agent apply --plan-file <plan.json>（plan 命令的完整 JSON 输出，含 signature）');
          const { readFileSync } = await import('node:fs');
          const parsed = JSON.parse(readFileSync(planFile, 'utf8')) as { plan: Parameters<typeof applyAgentConfig>[1]['plan']; signature: string };
          const r = await applyAgentConfig(service.store, { plan: parsed.plan, signature: parsed.signature });
          out(r, flags);
          break;
        }
        if (!agentKind || !AGENT_KINDS.includes(agentKind)) {
          throw new CairnError('E_VALIDATION', `用法: cairn agent plan|doctor|uninstall --host ${AGENT_KINDS.join('|')}，或 agent apply --plan-file <file>`);
        }
        const homeRoot = str(flags, 'home-root') ?? home ?? service.store.paths.home;
        const projectRoot = str(flags, 'project-root') ?? process.cwd();
        const mode = (str(flags, 'mode') ?? 'router') as ConfigMode;
        if (sub === 'plan') {
          const plan = await planAgentConfig(service.store, {
            agentKind, homeRoot, projectRoot, mode,
            mcpCommand: flags['mcp-command'] ? { command: str(flags, 'mcp-command')!, args: (str(flags, 'mcp-args') ?? '').split(' ').filter(Boolean) } : undefined,
          });
          out({ plan, signature: planSignature(plan) }, flags);
        } else if (sub === 'doctor') {
          out(await doctorAgentConfig(service.store, { agentKind, homeRoot, projectRoot }), flags);
        } else if (sub === 'uninstall') {
          out(await uninstallAgentConfig(service.store, { agentKind, homeRoot, projectRoot }), flags);
        } else {
          throw new CairnError('E_VALIDATION', '用法: cairn agent plan|apply|doctor|uninstall');
        }
        break;
      }

      case 'uninstall': {
        // 全局卸载：只移除本产品安装记录对应的宿主条目；数据库保留（由用户另行决定）
        const results: unknown[] = [];
        for (const kind of AGENT_KINDS) {
          const r = await uninstallAgentConfig(service.store, {
            agentKind: kind,
            homeRoot: str(flags, 'home-root') ?? home ?? service.store.paths.home,
            projectRoot: str(flags, 'project-root') ?? process.cwd(),
          });
          results.push({ host: kind, ...r });
        }
        out({ removed: results, database: '已保留；如需删除请手动移除数据目录（可先 cairn export 备份）' }, flags);
        break;
      }

      case 'discover': {
        const homeDir = str(flags, 'home-dir') ?? home ?? service.store.paths.home;
        const projectRoots = str(flags, 'project-root') ? [str(flags, 'project-root')!] : undefined;
        const sources = await service.discover({ homeDir, projectRoots });
        out(sources, flags);
        diag(`发现 ${sources.length} 个来源（仅元数据，未读取任何正文）。`);
        break;
      }

      case 'import': {
        const paths = args;
        if (paths.length === 0) throw new CairnError('E_VALIDATION', '用法: cairn import <文件...> [--agent-kind claude-code]');
        const agentKind = str(flags, 'agent-kind') ?? 'manual';
        const results: unknown[] = [];
        let lastBatch: string | null = null;
        for (const p of paths) {
          const r = await service.importFromPath({ sourcePath: p, agentKind, sourceKind: (str(flags, 'source-kind') as never) ?? 'markdown' });
          lastBatch = r.batchId;
          results.push({ source: p, ...r.outcome });
        }
        out({ imported: results, batchId: lastBatch }, flags);
        diag(`已建立本地档案（imported_unverified + local_only，不上行）。后续: cairn onboarding next --batch ${lastBatch}`);
        break;
      }

      case 'onboarding': {
        const sub = args[0] ?? 'status';
        const batchId = str(flags, 'batch') ?? service.activeBatchId();
        if (sub === 'status') {
          if (!batchId) {
            out({ activeBatch: null, note: '没有待整理批次' }, flags);
          } else {
            out({ ...service.batchStatus(batchId) }, flags);
          }
        } else if (sub === 'next') {
          if (!batchId) throw new CairnError('E_VALIDATION', '没有待整理批次；请先 cairn import');
          const chunk = service.batchChunk(batchId, flags['limit'] != null ? Number(flags['limit']) : 10);
          out({ batchId, items: chunk }, flags);
          diag('把以下条目交给当前 Agent 生成 add/merge/keep_both/skip 建议，然后 cairn plan create。');
        } else {
          throw new CairnError('E_VALIDATION', '用法: cairn onboarding status|next [--batch <id>]');
        }
        break;
      }

      case 'plan': {
        const sub = args[0];
        if (sub === 'create') {
          const itemsFile = str(flags, 'items-file');
          if (!itemsFile) throw new CairnError('E_VALIDATION', '用法: cairn plan create --items-file <items.json>（ProposedItem 数组）');
          const { readFileSync } = await import('node:fs');
          const items = JSON.parse(readFileSync(itemsFile, 'utf8')) as import('../../governance/propose.js').ProposedItem[];
          const r = service.proposeForBatch({ batchId: str(flags, 'batch'), items, proposedBy: str(flags, 'proposed-by') ?? 'cli' });
          out(r, flags);
          diag(`计划 ${r.plan.id} 已创建（awaiting_approval）。请审阅后执行: cairn approve ${r.plan.id}`);
        } else if (sub === 'show' || sub === 'list') {
          if (sub === 'show') {
            if (!args[1]) throw new CairnError('E_VALIDATION', '用法: cairn plan show <plan-id>');
            out(service.planSummary(args[1]!), flags);
          } else {
            const rows = service.store.db.all("SELECT id, status, item_count AS itemCount, created_at AS createdAt FROM onboarding_plan ORDER BY created_at DESC LIMIT 20");
            out(rows, flags);
          }
        } else {
          throw new CairnError('E_VALIDATION', '用法: cairn plan create|show|list');
        }
        break;
      }

      case 'approve': {
        if (!args[0]) throw new CairnError('E_VALIDATION', '用法: cairn approve <plan-id>');
        const summary = service.planSummary(args[0]!) as { plan: { status: string; itemCount: number }; counts: Record<string, number> };
        diag(`计划状态: ${summary.plan.status}，操作统计: ${JSON.stringify(summary.counts)}`);
        diag('批准即签发一次性、30 分钟有效的 approval_id；计划此后任何变化都会使其失效。');
        const r = service.approve(args[0]!, { ttlMs: flags['ttl'] != null ? Number(flags['ttl']) * 1000 : undefined });
        out(r, flags);
        diag(`应用: cairn apply ${args[0]} --approval ${r.approvalId}`);
        break;
      }

      case 'apply': {
        const planId = args[0];
        const approvalId = str(flags, 'approval');
        if (!planId || !approvalId) throw new CairnError('E_VALIDATION', '用法: cairn apply <plan-id> --approval <approval-id>');
        const r = service.applyPlan(planId, approvalId);
        out(r, flags);
        break;
      }

      default:
        throw new CairnError('E_VALIDATION', `未知命令: ${command}（见 cairn help）`);
    }
  } finally {
    service.close();
  }
}

const HELP = `Cairn — 个人、多设备、多 Agent 的本地优先记忆主权层

用法: cairn <command> [args] [options]

命令:
  init                          初始化数据目录并执行首次体检
  discover                      元数据发现（不读正文） [--home-dir] [--project-root]
  import <文件...>              不可变快照导入（imported_unverified + local_only） [--agent-kind]
  onboarding status|next        分批进度与待整理条目 [--batch] [--limit]
  add "内容"                    显式新增记忆 [--kind] [--scope] [--project] [--sensitive]
  search "关键词"               作用域约束检索 [--status] [--scope-id] [--include-expired]
  show <id>                     记忆详情（修订/证据/冲突）
  update <id> "新内容"          用户更正（新修订，历史保留）
  forget <id>                   遗忘（可审计 tombstone） [--reason]
  archive <id>                  归档
  export                        导出 [--format json|markdown] [--out FILE] [--include-archives]
  plan create|show|list         治理计划（create 需 --items-file，零写入）
  approve <plan-id>             本地签发一次性审批（绑定 plan_hash，30 分钟有效）
  apply <plan-id> --approval X  消费审批并幂等应用计划
  vault init-remote|status|export-key|import-key  云同步 vault（OBS / 自建 syncd）
  sync push|pull                加密同步上行 / 下行（详见 docs/cairn-sync.md）
  backup / restore              一致性备份与恢复
  doctor                        健康检查 [--host <agent>]（诚实分级，无模型无云端核心可用）
  status                        库状态摘要
  worker run-once               处理一轮后台任务 [--max N]（默认不安装任何 hook）
  device status|re-enroll       设备身份与克隆恢复
  agent plan|apply|doctor|uninstall --host <agent>  宿主配置管理（plan 零写入）
  uninstall                     移除所有本产品宿主配置（数据库保留）

全局选项:
  --home <dir>                  数据目录（默认 ~/.cairn；测试用 CAIRN_HOME）
  --json                        机器可读输出（stdout 仅结果；诊断走 stderr）
  --agent-id <id>               调用方 Agent 身份（默认 cli）

退出码: 0 成功; 1 故障; 2 用法/校验; 3 被治理拒绝; 4 状态冲突; 5 环境不可用`;

export async function runCli(): Promise<void> {
  try {
    await main();
  } catch (e) {
    if (isCairnError(e)) {
      if (process.argv.includes('--json')) {
        console.log(JSON.stringify({ error: e.toJSON() }, null, 2));
      } else {
        process.stderr.write(`[cairn] ${e.message}\n`);
        if (e.details) process.stderr.write(`[cairn] 详情: ${JSON.stringify(e.details)}\n`);
      }
      process.exitCode = e.exitCode;
    } else {
      process.stderr.write(`[cairn] 未预期错误: ${(e as Error).stack ?? String(e)}\n`);
      process.exitCode = ExitCode.failure;
    }
  }
}

// 直接执行时运行（被测试导入时不自动执行）
if (process.argv[1] != null && /cli[\\/]main\.(js|ts)$/.test(process.argv[1].replace(/\\/g, '/'))) {
  void runCli();
}
