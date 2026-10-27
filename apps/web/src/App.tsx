import { useEffect } from "react";
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

  return <WorkspaceShell workspace={workspace} />;
}
