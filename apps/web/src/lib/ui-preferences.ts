import { api } from "@/lib/api";
import type { UiPreferences } from "@motive/shared";

export const UI_PREFERENCES_BOOT_TIMEOUT_MS = 2_000;

/**
 * 启动时加载服务端权威偏好（SQLite）。
 * 任何失败或超时都返回 null——调用方保留当前 localStorage 偏好，
 * 不强制切换默认值，也不阻塞工作台正常使用。
 */
export async function fetchUiPreferences(
  timeoutMs: number = UI_PREFERENCES_BOOT_TIMEOUT_MS,
): Promise<UiPreferences | null> {
  try {
    return await Promise.race([
      api.getUiPreferences(),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } catch {
    return null;
  }
}
