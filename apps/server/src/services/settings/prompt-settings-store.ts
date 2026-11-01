import type { DatabaseSync } from "node:sqlite";
import type { PromptSettingsView, PromptStage } from "@motive/shared";
import { isPromptStage } from "@motive/shared";
import { HttpError } from "../../http-error.js";
import { DEFAULT_PROMPTS } from "../ai/effective-prompt.js";

const SETTINGS_KEY = "prompt_config";

/** 单条自定义提示词的最大长度；超出返回 400 且整次更新不生效 */
export const MAX_PROMPT_LENGTH = 20_000;

function emptySettings(): Record<PromptStage, string> {
  return {
    image_import: "",
    solution_generation: "",
    step_discussion: "",
    explanation_generation: "",
    archive_proposal: "",
  };
}

/**
 * 各环节自定义提示词存储（app_settings KV 键 prompt_config）。
 * 只保存用户覆盖值：未自定义或恢复默认的 stage 均不落库（等价于空字符串），
 * defaults 始终来自代码常量（effective-prompt.ts），不写入数据库。
 */
export class PromptSettingsStore {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  /** 读取用户自定义覆盖；存储数据损坏时忽略损坏键，回退为全部默认 */
  getSettings(): Record<PromptStage, string> {
    const result = emptySettings();
    const row = this.db
      .prepare("SELECT value FROM app_settings WHERE key = ?")
      .get(SETTINGS_KEY) as { value: string } | undefined;
    if (!row) return result;

    let parsed: unknown;
    try {
      parsed = JSON.parse(row.value);
    } catch {
      return result;
    }
    if (typeof parsed !== "object" || parsed === null) return result;

    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!isPromptStage(key)) continue;
      if (typeof value !== "string") continue;
      // 空白提示词等价于恢复默认，不作为覆盖值返回
      if (value.trim().length === 0) continue;
      if (value.length > MAX_PROMPT_LENGTH) continue;
      result[key] = value;
    }
    return result;
  }

  getView(): PromptSettingsView {
    return { settings: this.getSettings(), defaults: DEFAULT_PROMPTS };
  }

  /**
   * 部分更新：只覆盖 update 中出现的 stage，未出现的 stage 保留原值。
   * 先完成整个请求的全部校验再写库——任一字段非法（未知 stage / 非字符串 /
   * 超过 20000 字符）则整次更新失败，不允许部分写入。
   * 空字符串与纯空白字符串均表示恢复默认（不把默认文本写入数据库）。
   */
  save(update: Record<string, unknown>): PromptSettingsView {
    const normalized = new Map<PromptStage, string>();
    for (const [key, value] of Object.entries(update)) {
      if (!isPromptStage(key)) {
        throw new HttpError(400, "INVALID_FIELD", `未知的提示词环节：「${key}」`);
      }
      if (typeof value !== "string") {
        throw new HttpError(400, "INVALID_FIELD", `「${key}」的提示词必须是字符串`);
      }
      if (value.length > MAX_PROMPT_LENGTH) {
        throw new HttpError(
          400,
          "INVALID_FIELD",
          `「${key}」的提示词不能超过 ${MAX_PROMPT_LENGTH} 个字符`,
        );
      }
      normalized.set(key, value);
    }

    // 校验全部通过后才合并写入（node:sqlite 同步执行，读-改-写不会被打断）
    const merged = this.getSettings();
    for (const [stage, value] of normalized) {
      if (value.trim().length === 0) {
        delete merged[stage];
      } else {
        merged[stage] = value;
      }
    }

    this.db
      .prepare(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(SETTINGS_KEY, JSON.stringify(merged), Date.now());

    return this.getView();
  }
}
