import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { isNewerVersion } from "@/lib/version";

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
  | { phase: "available"; release: ReleaseInfo }
  | { phase: "failed" };

/**
 * 更新检查：启动时静默检查一次（auto），发现新版本才弹出模态框；
 * 设置关于页可手动触发并展示检查结果。
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
      if (release && isNewerVersion(release.tagName, info.version)) {
        setState({ phase: "available", release });
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
    // 启动静默检查：仅发现新版本时弹框，不展示检查过程
    void check(false);
  }, [auto, check]);

  return { open, setOpen, state, check };
}
