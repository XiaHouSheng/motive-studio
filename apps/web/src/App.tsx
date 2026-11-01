import { useEffect } from "react";
import { fetchUiPreferences } from "@/lib/ui-preferences";
import { usePreferencesStore } from "@/stores/preferences";
import { useThemeStore } from "@/stores/theme";
import { useWorkspace } from "@/features/workspace/use-workspace";
import { WorkspaceShell } from "@/features/workspace/workspace-shell";

export function App() {
  const workspace = useWorkspace();
  const syncSystemPreference = useThemeStore((state) => state.syncSystemPreference);

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => syncSystemPreference(event.matches);
    query.addEventListener("change", handleChange);
    syncSystemPreference(query.matches);
    return () => query.removeEventListener("change", handleChange);
  }, [syncSystemPreference]);

  // 启动后异步加载服务端权威偏好（SQLite）：不阻塞首帧与工作台使用；
  // 用户在加载完成前手动改过的字段不回填（迟到响应不覆盖用户操作）；
  // 加载失败或超时保留当前 localStorage 偏好，不强制切换默认值。
  useEffect(() => {
    let cancelled = false;
    void fetchUiPreferences().then((preferences) => {
      if (cancelled || !preferences) return;
      const theme = useThemeStore.getState();
      if (!theme.touched) theme.hydrate(preferences.theme);
      const preferencesState = usePreferencesStore.getState();
      if (!preferencesState.touched) preferencesState.hydrateLanguage(preferences.language);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return <WorkspaceShell workspace={workspace} />;
}
