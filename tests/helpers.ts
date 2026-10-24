import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** 合成测试 HOME：每个用例独立临时目录，绝不触真实用户目录。 */
export function makeTestHome(prefix = 'cairn-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function cleanupTestHome(dir: string): void {
  if (dir && dir.startsWith(tmpdir()) && existsSync(dir)) {
    // best-effort：测试失败遗留的句柄不应掩盖真实断言错误
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* 遗留在系统临时目录，不影响测试结论 */
    }
  }
}

export function silence(): void {
  // 预留：抑制噪音输出
}
