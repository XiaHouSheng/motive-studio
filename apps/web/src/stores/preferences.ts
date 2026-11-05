import { create } from "zustand";
import {
  isMarkdownFontSize,
  MD_FONT_SIZE_DEFAULT,
  type UiLanguage,
} from "@motive/shared";
import { PreferenceFieldQueue } from "@/lib/preferences-writer";

export const LANGUAGE_STORAGE_KEY = "motive.language";
export const MD_FONT_SIZE_STORAGE_KEY = "motive.mdFontSize";
export const DEFAULT_LANGUAGE: UiLanguage = "zh-CN";

/** 首帧后把语言同步到 <html lang>（index.html 预绘脚本已给出首帧值） */
export function applyDocumentLanguage(language: UiLanguage): void {
  document.documentElement.lang = language;
}

/** 把 Markdown 基准字号写到 <html> 的 CSS 变量上（index.html 预绘脚本已给出首帧值） */
export function applyDocumentMarkdownFontSize(size: number): void {
  document.documentElement.style.setProperty("--md-font-size", `${size}px`);
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

function initialMarkdownFontSize(): number {
  if (typeof window === "undefined") return MD_FONT_SIZE_DEFAULT;
  try {
    const stored = Number(window.localStorage.getItem(MD_FONT_SIZE_STORAGE_KEY));
    return isMarkdownFontSize(stored) ? stored : MD_FONT_SIZE_DEFAULT;
  } catch {
    return MD_FONT_SIZE_DEFAULT;
  }
}

interface PreferencesState {
  language: UiLanguage;
  markdownFontSize: number;
  /** 用户在启动偏好加载完成前是否手动改过语言（竞态守卫） */
  touched: boolean;
  /** 用户在启动偏好加载完成前是否手动改过字号（竞态守卫） */
  fontSizeTouched: boolean;
  setLanguage: (language: UiLanguage) => void;
  /** 应用服务端权威值：更新状态与 <html lang>，回写 localStorage，但不再次发请求 */
  hydrateLanguage: (language: UiLanguage) => void;
  setMarkdownFontSize: (size: number) => void;
  hydrateMarkdownFontSize: (size: number) => void;
}

/** 界面偏好写入队列（主题、语言、字号各自独立） */
export const languageWriteQueue = new PreferenceFieldQueue("language");
export const markdownFontSizeWriteQueue = new PreferenceFieldQueue<number>("markdownFontSize");

function persistMarkdownFontSize(size: number): void {
  try {
    window.localStorage.setItem(MD_FONT_SIZE_STORAGE_KEY, String(size));
  } catch {
    // 存储不可用时仅影响下次启动的默认值
  }
  applyDocumentMarkdownFontSize(size);
}

export const usePreferencesStore = create<PreferencesState>((set) => ({
  language: initialLanguage(),
  markdownFontSize: initialMarkdownFontSize(),
  touched: false,
  fontSizeTouched: false,
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
  setMarkdownFontSize: (size) => {
    persistMarkdownFontSize(size);
    set({ markdownFontSize: size, fontSizeTouched: true });
    markdownFontSizeWriteQueue.push(size);
  },
  hydrateMarkdownFontSize: (size) => {
    persistMarkdownFontSize(size);
    set({ markdownFontSize: size });
  },
}));
