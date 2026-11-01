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
import { PreferenceFieldQueue } from "@/lib/preferences-writer";

interface ThemeState {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  /** 用户在启动偏好加载完成前是否手动改过主题（竞态守卫） */
  touched: boolean;
  setMode: (mode: ThemeMode) => void;
  /** 应用服务端权威值：更新状态与 DOM，回写 localStorage，但不再次发请求 */
  hydrate: (mode: ThemeMode) => void;
  syncSystemPreference: (prefersDark: boolean) => void;
}

/** 主题偏好写入队列（与语言队列相互独立） */
export const themeWriteQueue = new PreferenceFieldQueue("theme");

function initialMode(): ThemeMode {
  if (typeof window === "undefined") return "system";
  return readStoredThemeMode();
}

const initialResolved =
  typeof window === "undefined" ? "light" : resolveTheme(initialMode(), prefersDarkMode());

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: initialMode(),
  resolved: initialResolved,
  touched: false,
  setMode: (mode) => {
    const resolved = resolveTheme(mode, prefersDarkMode());
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // 存储不可用时仅影响下次启动的默认值
    }
    applyResolvedTheme(resolved);
    set({ mode, resolved, touched: true });
    themeWriteQueue.push(mode);
  },
  hydrate: (mode) => {
    const resolved = resolveTheme(mode, prefersDarkMode());
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // 忽略
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
