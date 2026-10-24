import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 测试子进程入口解析：优先使用 dist 构建产物（纯 node 运行，无 tsx/esbuild
 * 服务进程），避免数百次 tsx spawn 泄漏孤儿进程耗尽系统资源。
 * dist 不存在时（纯源码态）回退 tsx + src。
 */

const repoRoot = join(import.meta.dirname ?? process.cwd(), '..');

export interface SpawnTarget {
  /** 子进程脚本路径 */
  file: string;
  /** node 的额外 loader 参数（dist 为空；src 态为 --import tsx） */
  loader: string[];
}

export function cliEntry(): SpawnTarget {
  const dist = join(repoRoot, 'dist', 'src', 'interfaces', 'cli', 'main.js');
  if (existsSync(dist)) return { file: dist, loader: [] };
  return { file: join(repoRoot, 'src', 'interfaces', 'cli', 'main.ts'), loader: ['--import', 'tsx'] };
}

export function mcpServerEntry(): SpawnTarget {
  const dist = join(repoRoot, 'dist', 'src', 'interfaces', 'mcp', 'server.js');
  if (existsSync(dist)) return { file: dist, loader: [] };
  return { file: join(repoRoot, 'src', 'interfaces', 'mcp', 'server.ts'), loader: ['--import', 'tsx'] };
}

export function concurrentWriterEntry(): SpawnTarget {
  const dist = join(repoRoot, 'dist', 'tests', 'integration', 'fixtures', 'concurrent-writer.mjs');
  if (existsSync(dist)) return { file: dist, loader: [] };
  return { file: join(repoRoot, 'tests', 'integration', 'fixtures', 'concurrent-writer.mts'), loader: ['--import', 'tsx'] };
}
