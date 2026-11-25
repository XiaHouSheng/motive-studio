import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { isPrereleaseVersion, isNewerVersion, versionKey } from "@/lib/version";

export interface ReleaseInfo {
  tagName: string;
  name: string | null;
  htmlUrl: string;
  publishedAt: string | null;
  body: string;
}

export type UpdateCheckState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "upToDate" }
  | { phase: "available"; release: ReleaseInfo; skipped: boolean }
  | { phase: "failed" };

const SKIPPED_VERSION_KEY = "motive.update.skippedVersion";

function readSkippedVersion(): string | null {
  try {
    return window.localStorage.getItem(SKIPPED_VERSION_KEY);
  } catch {
    return null;
  }
}

/** 跳过指定发行版：启动自动检查不再提醒该版本（手动检查仍可见） */
export function skipVersion(tagName: string): void {
  try {
    const key = versionKey(tagName);
    if (key) window.localStorage.setItem(SKIPPED_VERSION_KEY, key);
  } catch {
    // 持久化失败时静默忽略：本次会话仍可关闭弹窗
  }
}

/**
 * 更新检查：启动时静默检查一次（auto），发现新版本才弹出模态框；
 * 自动检查会过滤预发布（beta）发行版与用户跳过的版本；
 * 设置关于页可手动触发并展示完整检查结果（不受过滤影响）。
 */
export function useUpdateCheck(options: { auto?: boolean } = {}) {
  const { auto = false } = options;
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<UpdateCheckState>({ phase: "idle" });
  /** auto 检查只在应用启动时执行一次 */
  const autoCheckedRef = useRef(false);

  const check = useCallback(async (showDialog = true) => {
    if (showDialog) setOpen(true);
    setState({ phase: "checking" });
    try {
      const [info, result] = await Promise.all([api.getAppInfo(), api.getLatestRelease()]);
      const release = result.release;
      const releaseKey = release ? versionKey(release.tagName) : null;
      const matchesSkipped = releaseKey !== null && releaseKey === readSkippedVersion();

      if (release && isNewerVersion(release.tagName, info.version)) {
        // 启动静默检查：beta 发行版或已跳过的版本不自动弹框
        if (!showDialog && (isPrereleaseVersion(release.tagName) || matchesSkipped)) {
          setState({ phase: "upToDate" });
          return;
        }
        setState({ phase: "available", release, skipped: matchesSkipped });
        if (!showDialog) setOpen(true);
      } else {
        setState({ phase: release ? "upToDate" : "failed" });
        if (!showDialog) setOpen(false);
      }
    } catch {
      setState({ phase: "failed" });
      if (!showDialog) setOpen(false);
    }
  }, []);

  useEffect(() => {
    if (!auto || autoCheckedRef.current) return;
    autoCheckedRef.current = true;
    // 启动静默检查：仅发现未被过滤的新版本时弹框，不展示检查过程
    void check(false);
  }, [auto, check]);

  return { open, setOpen, state, check };
}
