import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import type { UiLanguage } from "@motive/shared";
import { usePreferencesStore } from "@/stores/preferences";
import { en } from "./en";
import { zhCN, type DictionaryKey } from "./zh-CN";

const DICTIONARIES: Record<UiLanguage, Record<DictionaryKey, string>> = {
  "zh-CN": zhCN,
  en,
};

export interface I18nContextValue {
  /** 当前语言（与界面偏好存储一致） */
  language: UiLanguage;
  /** 日期/时间/数字格式化使用的 locale（与语言同步） */
  locale: UiLanguage;
  /**
   * 取词条并做 {param} 插值。
   * 词条在两份字典中均存在（类型保证）；找不到 key 时回退 zh-CN 基准词条。
   */
  t: (key: DictionaryKey, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function interpolate(
  template: string,
  params: Record<string, string | number> | undefined,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

/**
 * 语言 Provider：语言状态来自 usePreferencesStore（localStorage 首帧值 +
 * 服务端权威回填）。切换语言只改变 context value 触发重渲染，
 * 不改变组件树结构（不改 key、不 remount），因此工作台数据、聊天状态与
 * 进行中的 SSE 请求不受影响。
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const language = usePreferencesStore((state) => state.language);

  const t = useCallback(
    (key: DictionaryKey, params?: Record<string, string | number>): string => {
      const template = DICTIONARIES[language][key] ?? zhCN[key];
      return interpolate(template, params);
    },
    [language],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ language, locale: language, t }),
    [language, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n 必须在 I18nProvider 内使用");
  }
  return context;
}

/** 便捷取词条 hook */
export function useT() {
  return useI18n().t;
}
