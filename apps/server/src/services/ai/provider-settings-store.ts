import type { DatabaseSync } from "node:sqlite";
import type {
  ProviderConfig,
  ProviderSettingsView,
} from "@motive/shared";
import { HttpError } from "../../http-error.js";
import type { CredentialStore } from "../credentials/credential-store.js";

const SETTINGS_KEY = "provider_config";
/**
 * 凭据存储键：P0 为单配置（default），后续多 profile 时扩展为 profileId 维度。
 * 该键只作为凭据存储的索引，不是密钥本身，也不会出现在任何 API 响应中。
 */
const CREDENTIAL_KEY = "provider:default";

export const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
  id: "default",
  name: "OpenAI 兼容服务",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  protocol: "openai-chat-completions",
  temperature: 0.5,
  supportsVision: true,
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function normalizeBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, "INVALID_CONFIG", "Base URL 不是有效的地址");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new HttpError(400, "INVALID_CONFIG", "Base URL 只支持 HTTPS");
  }
  if (url.protocol === "http:" && !LOCAL_HOSTS.has(url.hostname)) {
    throw new HttpError(
      400,
      "INVALID_CONFIG",
      "HTTP 仅允许 localhost / 127.0.0.1，其他地址必须使用 HTTPS",
    );
  }
  if (url.username || url.password) {
    throw new HttpError(400, "INVALID_CONFIG", "Base URL 不能包含用户名或密码");
  }
  if (url.search || url.hash) {
    throw new HttpError(400, "INVALID_CONFIG", "Base URL 不能包含查询参数或片段");
  }

  return url.toString().replace(/\/+$/, "");
}

function readNonEmpty(value: unknown, label: string, max: number): string {
  if (typeof value !== "string") {
    throw new HttpError(400, "INVALID_CONFIG", `${label} 必须是字符串`);
  }
  const trimmed = value.trim();
  if (!trimmed) throw new HttpError(400, "INVALID_CONFIG", `${label} 不能为空`);
  if (trimmed.length > max) {
    throw new HttpError(400, "INVALID_CONFIG", `${label} 不能超过 ${max} 个字符`);
  }
  return trimmed;
}

function readOptionalTemperature(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new HttpError(400, "INVALID_CONFIG", "temperature 必须是数字");
  }
  if (value < 0 || value > 2) {
    throw new HttpError(400, "INVALID_CONFIG", "temperature 需要在 0 到 2 之间");
  }
  return value;
}

function readOptionalMaxTokens(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new HttpError(400, "INVALID_CONFIG", "maxTokens 必须是整数");
  }
  if (value < 1 || value > 1_000_000) {
    throw new HttpError(400, "INVALID_CONFIG", "maxTokens 需要在 1 到 1000000 之间");
  }
  return value;
}

function normalizeConfig(input: Record<string, unknown>): ProviderConfig {
  const protocol = input.protocol ?? "openai-chat-completions";
  if (protocol !== "openai-chat-completions") {
    throw new HttpError(400, "INVALID_CONFIG", "暂只支持 openai-chat-completions 协议");
  }

  const id =
    typeof input.id === "string" && input.id.trim().length > 0
      ? input.id.trim()
      : DEFAULT_PROVIDER_CONFIG.id;

  return {
    id,
    name: readNonEmpty(input.name, "名称", 100),
    baseUrl: normalizeBaseUrl(readNonEmpty(input.baseUrl, "Base URL", 500)),
    model: readNonEmpty(input.model, "模型名称", 200),
    protocol: "openai-chat-completions",
    temperature: readOptionalTemperature(input.temperature),
    maxTokens: readOptionalMaxTokens(input.maxTokens),
    // 兼容服务多数支持视觉；显式传 false 才视为不支持
    supportsVision: input.supportsVision !== false,
  };
}

export class ProviderSettingsStore {
  private readonly db: DatabaseSync;
  private readonly credentials: CredentialStore;
  private apiKey: string | null = null;
  private credentialIssue: string | null = null;
  private restorePromise: Promise<void> | null = null;

  constructor(db: DatabaseSync, credentials: CredentialStore) {
    this.db = db;
    this.credentials = credentials;
  }

  /**
   * 启动时把已保存的密钥恢复进内存缓存（幂等，仅执行一次）。
   * 恢复失败不使用损坏数据：apiKey 置空并记录 credentialIssue，向用户明确警示。
   */
  restore(): Promise<void> {
    this.restorePromise ??= this.restoreInternal();
    return this.restorePromise;
  }

  private async restoreInternal(): Promise<void> {
    try {
      const stored = await this.credentials.get(CREDENTIAL_KEY);
      this.apiKey = stored && stored.trim().length > 0 ? stored : null;
      this.credentialIssue = null;
    } catch {
      this.apiKey = null;
      this.credentialIssue = "本机已保存的 API Key 无法解密，请重新保存密钥";
    }
  }

  getConfig(): ProviderConfig {
    const row = this.db
      .prepare("SELECT value FROM app_settings WHERE key = ?")
      .get(SETTINGS_KEY) as { value: string } | undefined;
    if (!row) return { ...DEFAULT_PROVIDER_CONFIG };

    try {
      const parsed = JSON.parse(row.value) as Record<string, unknown>;
      return { ...DEFAULT_PROVIDER_CONFIG, ...normalizeConfig(parsed) };
    } catch {
      return { ...DEFAULT_PROVIDER_CONFIG };
    }
  }

  getView(): ProviderSettingsView {
    return {
      provider: this.getConfig(),
      hasApiKey: this.apiKey !== null,
      credentialStorage: this.credentials.mode,
      credentialIssue: this.credentialIssue,
    };
  }

  /** 同步读取内存缓存中的密钥，供 AI 路由在请求期使用 */
  getApiKey(): string | null {
    return this.apiKey;
  }

  hasApiKey(): boolean {
    return this.apiKey !== null;
  }

  async save(input: {
    provider: unknown;
    apiKey?: string;
    clearApiKey?: boolean;
  }): Promise<ProviderSettingsView> {
    if (typeof input.provider !== "object" || input.provider === null) {
      throw new HttpError(400, "INVALID_CONFIG", "Provider 配置必须是对象");
    }
    const provider = normalizeConfig(input.provider as Record<string, unknown>);
    const updatedAt = Date.now();

    this.db
      .prepare(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(SETTINGS_KEY, JSON.stringify(provider), updatedAt);

    const nextApiKey =
      typeof input.apiKey === "string" && input.apiKey.trim().length > 0
        ? input.apiKey.trim()
        : undefined;

    try {
      if (input.clearApiKey) {
        // 删除失败必须报错，不谎报成功（内存状态保持不变）
        await this.credentials.delete(CREDENTIAL_KEY);
        this.apiKey = null;
        this.credentialIssue = null;
      } else if (nextApiKey) {
        await this.credentials.set(CREDENTIAL_KEY, nextApiKey);
        this.apiKey = nextApiKey;
        this.credentialIssue = null;
      }
    } catch {
      throw new HttpError(
        500,
        "CREDENTIAL_STORE_FAILED",
        "API Key 写入本机凭据存储失败，请检查系统凭据服务后重试（配置本身未受影响）",
      );
    }

    return this.getView();
  }
}
