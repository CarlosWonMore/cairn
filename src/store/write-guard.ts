/**
 * 写路径守卫：设备克隆/暂停状态下所有仓储写操作必须先通过本守卫。
 * openStore 在装配时注入；re-enroll 后由 store 更新守卫读取的状态。
 */
export type WriteGuard = () => void;

export class WriteGuardMixin {
  private guard: WriteGuard | null = null;

  setWriteGuard(g: WriteGuard | null): void {
    this.guard = g;
  }

  protected checkWritable(): void {
    this.guard?.();
  }
}
