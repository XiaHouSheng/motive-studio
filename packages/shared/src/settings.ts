/**
 * AI 环节标识：提示词设置存储、设置页与各生成器共用。
 * 顺序即设置页展示顺序。
 */
export const PROMPT_STAGES = [
  "image_import",
  "solution_generation",
  "step_discussion",
  "explanation_generation",
] as const;

export type PromptStage = (typeof PROMPT_STAGES)[number];

export function isPromptStage(value: unknown): value is PromptStage {
  return (
    typeof value === "string" &&
    (PROMPT_STAGES as readonly string[]).includes(value)
  );
}

/** 用户自定义提示词覆盖；未自定义的 stage 不含键或为空字符串（空 = 使用默认） */
export type PromptSettings = Partial<Record<PromptStage, string>>;

export interface PromptSettingsView {
  /** 仅包含用户自定义覆盖；未自定义或恢复默认的 stage 均为空字符串，不含默认文案 */
  settings: Record<PromptStage, string>;
  /** 代码内置默认提示词（来自生成器常量，不写入数据库） */
  defaults: Record<PromptStage, string>;
}

export type UiTheme = "light" | "dark" | "system";
export type UiLanguage = "zh-CN" | "en";

export const UI_THEMES: UiTheme[] = ["light", "dark", "system"];
export const UI_LANGUAGES: UiLanguage[] = ["zh-CN", "en"];

/** Markdown 渲染字号可配置范围（px，整数） */
export const MD_FONT_SIZE_MIN = 12;
export const MD_FONT_SIZE_MAX = 20;
export const MD_FONT_SIZE_DEFAULT = 15;

export function isMarkdownFontSize(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MD_FONT_SIZE_MIN &&
    value <= MD_FONT_SIZE_MAX
  );
}

export function isUiTheme(value: unknown): value is UiTheme {
  return typeof value === "string" && UI_THEMES.includes(value as UiTheme);
}

export function isUiLanguage(value: unknown): value is UiLanguage {
  return typeof value === "string" && UI_LANGUAGES.includes(value as UiLanguage);
}

/** 界面偏好；SQLite 为权威值，localStorage 仅负责首帧预绘与失败回退 */
export interface UiPreferences {
  /** 用户选择的主题模式（非解析后的实际主题） */
  theme: UiTheme;
  language: UiLanguage;
  /** Markdown 渲染内容的基准字号（px），驱动 CSS 变量 --md-font-size */
  markdownFontSize: number;
}
