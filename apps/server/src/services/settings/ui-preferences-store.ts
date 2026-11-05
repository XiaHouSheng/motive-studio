import type { DatabaseSync } from "node:sqlite";
import type { UiPreferences } from "@motive/shared";
import { isMarkdownFontSize, isUiLanguage, isUiTheme, MD_FONT_SIZE_DEFAULT } from "@motive/shared";
import { HttpError } from "../../http-error.js";

const SETTINGS_KEY = "ui_preferences";

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  theme: "system",
  language: "zh-CN",
  markdownFontSize: MD_FONT_SIZE_DEFAULT,
};

/**
 * 界面偏好存储（app_settings KV 键 ui_preferences）。
 * SQLite 是权威值；客户端 localStorage 仅负责首帧预绘与请求失败时的本地回退。
 */
export class UiPreferencesStore {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  /** 读取完整偏好；未保存或数据损坏时回退默认值 */
  get(): UiPreferences {
    const row = this.db
      .prepare("SELECT value FROM app_settings WHERE key = ?")
      .get(SETTINGS_KEY) as { value: string } | undefined;
    if (!row) return { ...DEFAULT_UI_PREFERENCES };

    try {
      const parsed = JSON.parse(row.value) as Record<string, unknown>;
      return {
        theme: isUiTheme(parsed.theme) ? parsed.theme : DEFAULT_UI_PREFERENCES.theme,
        language: isUiLanguage(parsed.language)
          ? parsed.language
          : DEFAULT_UI_PREFERENCES.language,
        markdownFontSize: isMarkdownFontSize(parsed.markdownFontSize)
          ? parsed.markdownFontSize
          : DEFAULT_UI_PREFERENCES.markdownFontSize,
      };
    } catch {
      return { ...DEFAULT_UI_PREFERENCES };
    }
  }

  /**
   * 部分更新：只覆盖 input 中明确提供的字段，未提供字段保持原值。
   * 未知字段或非法值返回 400；先整体校验再写库，整次更新原子生效。
   * node:sqlite 为同步 API，读-改-写在同一同步块内完成，
   * 并发请求不会互相覆盖不同字段。
   */
  save(input: Record<string, unknown>): UiPreferences {
    const next = this.get();

    for (const [key, value] of Object.entries(input)) {
      if (key === "theme") {
        if (!isUiTheme(value)) {
          throw new HttpError(400, "INVALID_FIELD", "theme 必须是 light / dark / system");
        }
        next.theme = value;
      } else if (key === "language") {
        if (!isUiLanguage(value)) {
          throw new HttpError(400, "INVALID_FIELD", "language 必须是 zh-CN / en");
        }
        next.language = value;
      } else if (key === "markdownFontSize") {
        if (!isMarkdownFontSize(value)) {
          throw new HttpError(
            400,
            "INVALID_FIELD",
            "markdownFontSize 必须是 12 到 20 之间的整数",
          );
        }
        next.markdownFontSize = value;
      } else {
        throw new HttpError(400, "INVALID_FIELD", `不支持的字段：「${key}」`);
      }
    }

    this.db
      .prepare(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(SETTINGS_KEY, JSON.stringify(next), Date.now());

    return next;
  }
}
