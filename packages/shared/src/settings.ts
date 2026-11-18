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

/** 桌面端内嵌 frpc 状态；web 方式部署无 frpc 字段 */
export interface FrpcState {
  /** frpc 可执行文件是否可用（不可用时无法广播） */
  available: boolean;
  status: "stopped" | "running" | "error";
  /** 非运行状态的补充说明（二进制缺失原因 / 退出码与最近日志） */
  detail?: string;
}

/** 远程接入状态视图；token/accessUrl 仅对本机回环请求返回 */
export interface RemoteAccessView {
  /** 启用后：非本机请求必须携带访问密钥（并启动内嵌 frpc 广播） */
  enabled: boolean;
  /** 公网入口 origin（如 https://motive.example.duckdns.org:39222）；空串表示未配置 */
  publicOrigin: string;
  /** frps 服务器地址（IP 或域名；控制通道端口固定 39220） */
  serverAddr: string;
  /** 是否已设置 frps 认证令牌（令牌本体永不回传） */
  frpsTokenSet: boolean;
  /** 是否已生成访问密钥；门卫实际激活需要 enabled 且已生成 */
  hasToken: boolean;
  /** 完整访问密钥（仅本机回环返回） */
  token?: string;
  /** 带 ?t= 的一键访问链接（仅本机回环且已配置公网入口时返回） */
  accessUrl?: string | null;
  /** 桌面版内嵌 frpc 状态；web 方式无此字段 */
  frpc?: FrpcState;
}
