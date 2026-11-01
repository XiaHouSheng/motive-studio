import { create } from "zustand";
import type { UiLanguage } from "@motive/shared";
import { PreferenceFieldQueue } from "@/lib/preferences-writer";

export const LANGUAGE_STORAGE_KEY = "motive.language";
export const DEFAULT_LANGUAGE: UiLanguage = "zh-CN";

/** 首帧后把语言同步到 <html lang>（index.html 预绘脚本已给出首帧值） */
export function applyDocumentLanguage(language: UiLanguage): void {
  document.documentElement.lang = language;
}

function initialLanguage(): UiLanguage {
  if (typeof window === "undefined") return DEFAULT_LANGUAGE;
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return stored === "en" ? "en" : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

interface PreferencesState {
  language: UiLanguage;
  /** 用户在启动偏好加载完成前是否手动改过语言（竞态守卫） */
  touched: boolean;
  setLanguage: (language: UiLanguage) => void;
  /** 应用服务端权威值：更新状态与 <html lang>，回写 localStorage，但不再次发请求 */
  hydrateLanguage: (language: UiLanguage) => void;
}

/** 语言偏好写入队列（与主题队列相互独立） */
export const languageWriteQueue = new PreferenceFieldQueue("language");

export const usePreferencesStore = create<PreferencesState>((set) => ({
  language: initialLanguage(),
  touched: false,
  setLanguage: (language) => {
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // 存储不可用时仅影响下次启动的默认值
    }
    applyDocumentLanguage(language);
    set({ language, touched: true });
    languageWriteQueue.push(language);
  },
  hydrateLanguage: (language) => {
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // 忽略
    }
    applyDocumentLanguage(language);
    set({ language });
  },
}));
