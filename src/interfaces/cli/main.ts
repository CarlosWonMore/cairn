#!/usr/bin/env node
import { AppService, ExitCode } from '../app-service.js';
import { CairnError, isCairnError } from '../../core/errors.js';
import { HOST_ADAPTERS, AgentKind, resolveDshHome, setDshProfile } from '../../agents/adapters.js';
import {
  planAgentConfig,
  applyAgentConfig,
  planSignature,
  doctorAgentConfig,
  uninstallAgentConfig,
  ConfigMode,
} from '../../agents/config.js';
import { backupDatabase, restoreFromBackup } from '../../store/backup.js';
import { openStore } from '../../store/open.js';
import { startConsoleServer } from '../console/server.js';
import { exportConsoleHtml, normalizePersonalName } from '../console/export.js';
import { readReviews, reviewPackForBatch, reviewSubmit } from '../console/review-store.js';
import { judgementFromFlags } from '../../onboarding/judgement.js';
import { loadPolicy, listPolicies, revokePolicy, signPolicy } from '../../onboarding/policy.js';
import { revokeByPolicy, runAutoOnboarding } from '../../onboarding/auto.js';
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
  'expires', 'status', 'limit', 'out', 'format', 'reason', 'host', 'home-root', 'project-root', 'dsh-profile', 'dsh-profile',
  'mode', 'plan-file', 'mcp-command', 'mcp-args', 'max', 'expected-revision', 'approval', 'ttl',
  'home-dir', 'agent-kind', 'source-kind', 'proposed-by', 'items-file', 'batch', 'provider',
  'endpoint', 'bucket', 'prefix', 'base-url', 'recovery-file', 'port', 'input', 'item', 'export',
  'policy', 'file', 'id', 'scopes', 'max-sensitivity', 'min-confidence', 'note', 'items',
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

  // ui 全程只读：连 AppService 都不打开，确保"只看一眼"在数据目录层面零写入。
  if (command === 'ui') {
    await runUi(flags, home);
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
        if (!content) throw new CairnError('E_VALIDATION', '用法: cairn add "内容" [--kind fact] [--scope ...] [--judgement keep|skip|merge_into:<id> --confidence high|medium|low --rationale "..."] [--dedupe merge|keep_both]');
        const r = service.addMemory(
          {
            content,
            kind: str(flags, 'kind') as never,
            sensitivity: flags['sensitive'] === true ? 'sensitive' : 'normal',
            expiresAt: str(flags, 'expires') ?? null,
            scope: scopeSelectionFrom(flags),
          },
          { judgement: judgementFromFlags(flags) },
        );
        if (r.action === 'skip') {
          out({ skipped: true, basis: r.basis, note: '按判断未写入；判断是建议，需要写入可去掉 --judgement skip' }, flags);
          break;
        }
        const m = r.memory!;
        out(
          {
            id: m.id,
            status: m.status,
            authority: m.authority,
            kind: m.kind,
            scopeId: m.scopeId,
            action: r.action,
            basis: r.basis,
            duplicateOf: r.duplicateOf,
          },
          flags,
        );
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
        // DSH 的数据根与用户主目录是两个概念：显式 --home-root → DSH_HOME → 报错（不回退 ~/.dsh）。
        setDshProfile(str(flags, 'dsh-profile') ?? null);
        const homeRoot =
          agentKind === 'dsh'
            ? resolveDshHome(str(flags, 'home-root') ?? home)
            : (str(flags, 'home-root') ?? home ?? service.store.paths.home);
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

      case 'review': {
        const sub = args[0] ?? 'list';
        if (sub === 'pack') {
          const r = reviewPackForBatch(service.store, {
            batchId: str(flags, 'batch'),
            outFile: str(flags, 'out'),
          });
          out(r, flags);
          diag(`复核包已写入 ${r.outFile}`);
          diag('下一步：把该文件交给当前 Agent 会话逐条判断，产出 { runId, items:[{itemId,action,reason,targetMemoryId}] }，再 cairn review submit --input <file>');
          diag('注意：这一步会把条目正文交给模型读取；范围与字符量见上面的 itemCount / totalChars。');
        } else if (sub === 'submit') {
          const input = str(flags, 'input');
          if (!input) throw new CairnError('E_VALIDATION', '用法: cairn review submit --input <reviews.json>（{ items: [...] }）');
          const { readFileSync } = await import('node:fs');
          const parsed = JSON.parse(readFileSync(input, 'utf8')) as { items?: unknown[]; runId?: string; model?: string };
          const items = Array.isArray(parsed.items) ? parsed.items : Array.isArray(parsed as unknown) ? (parsed as unknown as unknown[]) : [];
          const r = reviewSubmit(service.store, {
            items,
            producer: str(flags, 'proposed-by') ?? 'cli',
            model: parsed.model ?? null,
            runId: parsed.runId,
          });
          out(r, flags);
        } else if (sub === 'list') {
          out(readReviews(service.store, { batchId: str(flags, 'batch'), itemId: str(flags, 'item') }), flags);
        } else {
          throw new CairnError('E_VALIDATION', '用法: cairn review pack|submit|list [--batch] [--out] [--input]');
        }
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
        } else if (sub === 'auto') {
          const policyId = str(flags, 'policy');
          if (!policyId) {
            throw new CairnError('E_VALIDATION', '用法: cairn onboarding auto --policy <id> [--batch <id>] [--scope ...] [--dry-run] [--redo] [--items a,b]');
          }
          const itemList = str(flags, 'items');
          const r = runAutoOnboarding(service.store, {
            policyId,
            batchId: str(flags, 'batch'),
            scope: scopeSelectionFrom(flags),
            dryRun: flags['dry-run'] === true,
            // --redo：已晋升的条目也重新判；--items：只处理点名的几条（同样视为显式重做）。
            redo: flags['redo'] === true,
            itemIds: itemList != null ? itemList.split(',').map((s) => s.trim()).filter((s) => s.length > 0) : undefined,
          });
          out(r, flags);
          diag(
            `策略 ${r.policyId}(${r.policyHashPrefix})：自动 ${r.auto} 条 / 人工 ${r.manual} 条；` +
              `应用 ${r.applied}、跳过 ${r.skipped}、失败 ${r.failed}`,
          );
          if (r.dryRun) diag('这是 dry-run：没有写入任何记忆。去掉 --dry-run 才会真正应用。');
          if (!r.balanced) {
            throw new CairnError('E_INTERNAL', `汇总不自洽：applied ${r.applied} + skipped ${r.skipped} + failed ${r.failed} + manual ${r.manual} ≠ total ${r.totalItems}`);
          }
          if (r.applied === 0 && r.skipped > 0 && r.failed === 0) {
            diag('全部跳过：通常是内容已全部在库中（已并入或已存在），这是正常结局；要重新判一遍加 --redo。');
          }
          if (r.manual > 0) {
            const top = Object.entries(r.byCondition).sort((a, b) => b[1] - a[1]).slice(0, 3);
            diag(`转人工的首要原因：${top.map(([k, v]) => `${k} ${v} 条`).join('、') || '无'}（用 cairn ui 查看明细）`);
          }
        } else if (sub === 'revoke') {
          // 撤销"结果"与撤销"授权"是两件事：
          //   policy revoke        → 这把钥匙作废，不能再用于未来的自动整理
          //   onboarding revoke    → 把已经写进去的记忆转墓碑，回滚这次整理
          const policyId = str(flags, 'policy') ?? args[1];
          if (!policyId) {
            throw new CairnError('E_VALIDATION', '用法: cairn onboarding revoke --policy <id> [--batch <id>]');
          }
          const r = revokeByPolicy(service.store, policyId, { batchId: str(flags, 'batch') });
          out(r, flags);
          diag(`已撤销 ${r.tombstoned} 条记忆（转墓碑，不物理删除，修订与来源仍在）。撤销是粘的：普通重跑不会把它们写回来，要重做须 --redo。`);
        } else {
          throw new CairnError('E_VALIDATION', '用法: cairn onboarding status|next|auto|revoke [--batch <id>] [--policy <id>] [--dry-run] [--redo]');
        }
        break;
      }

      case 'policy': {
        const sub = args[0] ?? 'list';
        if (sub === 'sign') {
          const file = str(flags, 'file');
          let raw: unknown;
          if (file) {
            const { readFileSync } = await import('node:fs');
            raw = JSON.parse(readFileSync(file, 'utf8'));
          } else {
            const id = str(flags, 'id');
            if (!id) {
              throw new CairnError(
                'E_VALIDATION',
                '用法: cairn policy sign --file <policy.json> [--force]；或 cairn policy sign --id <名字> --scopes a,b [--max-sensitivity normal|sensitive] [--min-confidence 0-1] [--allow-create] [--require-ai-agreement] [--note 备注] [--force]',
              );
            }
            // 命令行拼装时保持保守默认：不新建、不因"没判断"就放行。
            raw = {
              id,
              allowedScopes: (str(flags, 'scopes') ?? '').split(',').map((x) => x.trim()).filter(Boolean),
              maxSensitivity: str(flags, 'max-sensitivity') ?? 'normal',
              requireAiAgreement: flags['require-ai-agreement'] === true,
              allowCreate: flags['allow-create'] === true,
              minConfidence: flags['min-confidence'] != null ? Number(str(flags, 'min-confidence')) : 0.6,
              note: str(flags, 'note') ?? '',
            };
          }
          const signed = signPolicy(service.store.paths.home, raw, { via: 'cli', force: flags['force'] === true });
          out({ id: signed.spec.id, policyHash: signed.policyHash, signedAt: signed.signedAt, via: signed.signedVia, spec: signed.spec }, flags);
          diag(`策略 ${signed.spec.id} 已签发，哈希 ${signed.policyHash.slice(0, 8)}。改动策略内容后必须重新签发。`);
        } else if (sub === 'list') {
          out(listPolicies(service.store.paths.home), flags);
        } else if (sub === 'show') {
          const id = args[1] ?? str(flags, 'id');
          if (!id) throw new CairnError('E_VALIDATION', '用法: cairn policy show <id>');
          out(loadPolicy(service.store.paths.home, id), flags);
        } else if (sub === 'revoke') {
          const id = args[1] ?? str(flags, 'id');
          if (!id) throw new CairnError('E_VALIDATION', '用法: cairn policy revoke <id>');
          const r = revokePolicy(service.store.paths.home, id);
          out({ id: r.spec.id, revokedAt: r.revokedAt }, flags);
          diag(`策略 ${id} 已撤销：这把钥匙不能再用于 onboarding auto；它已经写进去的记忆不受影响，要回滚结果请用 cairn onboarding revoke --policy ${id}。`);
        } else {
          throw new CairnError('E_VALIDATION', '用法: cairn policy sign|list|show|revoke');
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

/**
 * `cairn ui`：只读打开。全流程不构造 AppService，因此"只看一眼"不会写 meta/device。
 *
 * 两种形态共用同一套装配层与前端资源，差异只在传输方式：
 * - 默认：回环 HTTP 服务（工作台，可审批/同步）；
 * - `--export`：单文件 HTML（预览，纯只读，可双击打开或离线分享）。
 */
async function runUi(flags: Flags, home: string | undefined): Promise<void> {
  const exportTarget = str(flags, 'export');
  const redact = flags['redact'] === true;

  if (exportTarget != null) {
    const store = openStore({ home, readOnly: true });
    try {
      const outFile = normalizePersonalName(exportTarget);
      const r = exportConsoleHtml(store, { outFile, redact });
      out(
        {
          written: r.outFile,
          bytes: r.bytes,
          counts: r.counts,
          redacted: r.redacted,
          degradedItems: r.degradedItems,
          warnings: r.warnings,
        },
        flags,
      );
      // 三层告知的第 3 层：stdout。前两层是文件名后缀与文件头警示。
      if (!r.redacted) {
        diag(
          `产物含明文本地记忆（${r.counts.memories} 条记忆 / ${r.counts.items} 条快照条目，${r.bytes} 字节）：请勿外传；需要外发请加 --redact。`,
        );
      } else {
        diag('已按 --redact 输出：sensitive 记忆正文已掩码。');
      }
      for (const w of r.warnings) diag(w);
    } finally {
      store.close();
    }
    return;
  }

  const portFlag = str(flags, 'port');
  const port = portFlag != null ? Number(portFlag) : undefined;
  if (port != null && (!Number.isInteger(port) || port < 0 || port > 65535)) {
    throw new CairnError('E_VALIDATION', '--port 必须是 0-65535 的整数');
  }
  const handle = await startConsoleServer({ home, port });
  if (flags['json'] === true) {
    console.log(JSON.stringify({ url: handle.url, tokenUrl: handle.tokenUrl, port: handle.port, host: handle.host }, null, 2));
  } else {
    console.log(`控制台已启动：${handle.tokenUrl}`);
    console.log('令牌随进程一次性有效；按 Ctrl+C 停止服务。');
  }
  const noOpen = flags['no-open'] === true;
  if (!noOpen) openBrowser(handle.tokenUrl);
  await new Promise<void>((resolve) => {
    const stop = () => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      void handle.close().then(() => resolve());
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  });
}

/** best-effort 打开浏览器：失败不影响服务可用，用户可复制 stdout 里的 URL。 */
function openBrowser(url: string): void {
  void (async () => {
    try {
      const { spawn } = await import('node:child_process');
      const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
      const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
      const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
      child.on('error', () => {
        /* 无浏览器环境：URL 已在 stdout */
      });
      child.unref();
    } catch {
      /* 同上 */
    }
  })();
}

const HELP = `Cairn — 个人、多设备、多 Agent 的本地优先记忆主权层

用法: cairn <command> [args] [options]

命令:
  init                          初始化数据目录并执行首次体检
  discover                      元数据发现（不读正文） [--home-dir] [--project-root]
  import <文件...>              不可变快照导入（imported_unverified + local_only） [--agent-kind]
  onboarding status|next|auto   分批进度与待整理条目 [--batch] [--limit]
                                auto: 按已签发策略自动整理 [--policy <id>] [--dry-run] [--redo] [--items a,b]
                                revoke: 回滚某策略写进去的记忆（转墓碑）[--policy <id>] [--batch <id>]
  add "内容"                    显式新增记忆 [--kind] [--scope] [--project] [--sensitive]
                                [--judgement keep|skip|merge_into:<id> --confidence --rationale]
  search "关键词"               作用域约束检索 [--status] [--scope-id] [--include-expired]
  show <id>                     记忆详情（修订/证据/冲突）
  update <id> "新内容"          用户更正（新修订，历史保留）
  forget <id>                   遗忘（可审计 tombstone） [--reason]
  archive <id>                  归档
  export                        导出 [--format json|markdown] [--out FILE] [--include-archives]
  plan create|show|list         治理计划（create 需 --items-file，零写入）
  approve <plan-id>             本地签发一次性审批（绑定 plan_hash，30 分钟有效）
  apply <plan-id> --approval X  消费审批并幂等应用计划
  review pack|submit|list       双层建议的复核包与写回 [--batch] [--out] [--input]
  policy sign|list|show|revoke  自动整理策略（签发只在终端或本机控制台）[--file] [--id] [--force]
  ui                            只读控制台（回环 HTTP；端口默认 7767，占用则随机）
                                [--port N] [--no-open] [--export <file.html>] [--redact]
  vault init-remote|status|export-key|import-key  云同步 vault（OBS / 自建 syncd）
  sync push|pull                加密同步上行 / 下行（详见 docs/cairn-sync.md）
  backup / restore              一致性备份与恢复
  doctor                        健康检查 [--host <agent>]（诚实分级，无模型无云端核心可用）
  status                        库状态摘要
  worker run-once               处理一轮后台任务 [--max N]（默认不安装任何 hook）
  device status|re-enroll       设备身份与克隆恢复
  agent plan|apply|doctor|uninstall --host <agent>  宿主配置管理（plan 零写入）；--host dsh 用于 DeepSeek Harness（Cordis 插件树，可加 --dsh-profile）
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
