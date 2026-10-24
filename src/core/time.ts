/** ISO-8601 UTC（毫秒精度，'Z' 结尾）——数据库统一时间形态。 */
export function nowIso(): string {
  return new Date().toISOString();
}

export function toIso(d: Date): string {
  return d.toISOString();
}

export function isoPlusMs(iso: string, ms: number): string {
  return new Date(new Date(iso).getTime() + ms).toISOString();
}

export function isExpired(expiresAt: string | null | undefined, at: string = nowIso()): boolean {
  return expiresAt != null && expiresAt <= at;
}

/** 加法解析天数；非法输入由调用方校验。 */
export function daysToMs(days: number): number {
  return days * 24 * 60 * 60 * 1000;
}
