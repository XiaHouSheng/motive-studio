import { api } from "@/lib/api";

/**
 * 界面偏好写入队列：同一字段的 PUT 请求串行化，且始终以最新待写值发送，
 * 保证后发的用户操作具有最终持久化优先级——请求乱序不会让旧值覆盖新值。
 * 同一事件循环内的连续切换会在微任务中合并为一次请求。
 * 主题与语言分别维护独立队列实例，互不阻塞。
 * 请求失败时静默处理：保留当前 UI 状态与 localStorage，不自动回滚用户操作，
 * 也不无限重试；用户下次操作会以新值再次入队。
 */
export class PreferenceFieldQueue {
  private pendingValue: string | undefined;
  private inFlight = false;
  private scheduled = false;

  constructor(
    private readonly field: "theme" | "language",
    private readonly write: (field: "theme" | "language", value: string) => Promise<unknown> = (
      name,
      value,
    ) => api.saveUiPreferences({ [name]: value }),
  ) {}

  /** 入队一次写入；已有写入进行中时仅更新待写值（合并为最新选择） */
  push(value: string): void {
    this.pendingValue = value;
    if (this.inFlight || this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      this.flush();
    });
  }

  /** 当前是否有写入在进行或待写（测试用） */
  isBusy(): boolean {
    return this.inFlight || this.pendingValue !== undefined;
  }

  private flush(): void {
    const value = this.pendingValue;
    if (value === undefined) return;
    this.pendingValue = undefined;
    this.inFlight = true;
    this.write(this.field, value)
      .catch(() => {
        // 持久化失败不回滚本地状态，等待用户下次操作
      })
      .finally(() => {
        this.inFlight = false;
        this.flush();
      });
  }
}
