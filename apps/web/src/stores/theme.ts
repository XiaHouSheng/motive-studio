import { create } from "zustand";
import {
  THEME_STORAGE_KEY,
  applyResolvedTheme,
  prefersDarkMode,
  readStoredThemeMode,
  resolveTheme,
  type ResolvedTheme,
  type ThemeMode,
} from "@/lib/theme";

interface ThemeState {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
  syncSystemPreference: (prefersDark: boolean) => void;
}

function initialMode(): ThemeMode {
  if (typeof window === "undefined") return "system";
  return readStoredThemeMode();
}

const initialResolved =
  typeof window === "undefined" ? "light" : resolveTheme(initialMode(), prefersDarkMode());

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: initialMode(),
  resolved: initialResolved,
  setMode: (mode) => {
    const resolved = resolveTheme(mode, prefersDarkMode());
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // 存储不可用时仅影响下次启动的默认值
    }
    applyResolvedTheme(resolved);
    set({ mode, resolved });
  },
  syncSystemPreference: (prefersDark) => {
    const { mode } = get();
    if (mode !== "system") return;
    const resolved = resolveTheme(mode, prefersDark);
    applyResolvedTheme(resolved);
    set({ resolved });
  },
}));
