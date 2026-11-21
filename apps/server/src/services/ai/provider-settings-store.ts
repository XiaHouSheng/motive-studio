import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  ProviderConfig,
  ProviderProfilesView,
  ProviderSettingsView,
} from "@motive/shared";
import { HttpError } from "../../http-error.js";
import type { CredentialStore } from "../credentials/credential-store.js";

const SETTINGS_KEY = "provider_config";
/** 模型配置列表：{ activeId, profiles: ProviderConfig[] }，激活配置同时镜像到 provider_config */
const PROFILES_KEY = "provider_profiles";
/**
 * 凭据存储键：按配置维度隔离（每个模型配置各自记住 API Key）。
 * 该键只作为凭据存储的索引，不是密钥本身，也不会出现在任何 API 响应中。
 * 早期版本只有单一配置，其密钥固定存于 provider:default，因此默认配置继续沿用该键。
 */
function credentialKeyFor(profileId: string): string {
  return `provider:${profileId}`;
}
/** 密钥保存时间的元数据键前缀（仅记录时间，不含密钥任何信息） */
const CREDENTIAL_META_KEY = "provider_credential_meta";
function credentialMetaKeyFor(profileId: string): string {
  return `${CREDENTIAL_META_KEY}:${profileId}`;
}

/**
 * 生成密钥的脱敏预览：保留前 3 位与末 4 位，其余以圆点代替。
 * 过短的密钥可辨认字符过多，全部打码。结果不含任何可用于还原明文的信息。
 */
export function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length < 12) return "••••••••";
  return `${trimmed.slice(0, 3)}••••${trimmed.slice(-4)}`;
}

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
    await this.reloadActiveKey();
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

  // ---------- 多配置（profile）管理 ----------

  private upsertSetting(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value, Date.now());
  }

  private writeProfilesState(state: {
    activeId: string;
    profiles: ProviderConfig[];
  }): void {
    this.upsertSetting(PROFILES_KEY, JSON.stringify(state));
  }

  /**
   * 读取配置列表。旧版数据（只有 provider_config 单配置）在首次读取时
   * 懒迁移为仅含该配置的列表，无需用户感知。
   */
  private readProfilesState(): { activeId: string; profiles: ProviderConfig[] } {
    const row = this.db
      .prepare("SELECT value FROM app_settings WHERE key = ?")
      .get(PROFILES_KEY) as { value: string } | undefined;
    if (row) {
      try {
        const parsed = JSON.parse(row.value) as {
          activeId?: unknown;
          profiles?: unknown;
        };
        if (typeof parsed.activeId === "string" && Array.isArray(parsed.profiles)) {
          const profiles = parsed.profiles
            .filter((item) => typeof item === "object" && item !== null)
            .map((item) => normalizeConfig(item as Record<string, unknown>));
          if (
            profiles.length > 0 &&
            profiles.some((profile) => profile.id === parsed.activeId)
          ) {
            return { activeId: parsed.activeId, profiles };
          }
        }
      } catch {
        // 数据损坏时按缺失处理，走下方迁移重建
      }
    }

    const current = this.getConfig();
    const state = { activeId: current.id, profiles: [current] };
    this.writeProfilesState(state);
    return state;
  }

  private readActiveId(): string {
    return this.readProfilesState().activeId;
  }

  /** 从凭据存储重载当前激活配置的密钥到内存缓存（切换/启动恢复共用） */
  private async reloadActiveKey(): Promise<void> {
    try {
      const stored = await this.credentials.get(credentialKeyFor(this.readActiveId()));
      this.apiKey = stored && stored.trim().length > 0 ? stored : null;
      this.credentialIssue = null;
    } catch {
      this.apiKey = null;
      this.credentialIssue = "本机已保存的 API Key 无法解密，请重新保存密钥";
    }
  }

  /** 读取指定配置密钥的保存时间；无记录或数据异常时返回 null（default 回退旧版单键） */
  private readSavedAt(profileId: string): number | null {
    const keys =
      profileId === DEFAULT_PROVIDER_CONFIG.id
        ? [credentialMetaKeyFor(profileId), CREDENTIAL_META_KEY]
        : [credentialMetaKeyFor(profileId)];
    for (const key of keys) {
      const row = this.db
        .prepare("SELECT value FROM app_settings WHERE key = ?")
        .get(key) as { value: string } | undefined;
      if (!row) continue;
      try {
        const parsed = JSON.parse(row.value) as { savedAt?: unknown };
        if (typeof parsed.savedAt === "number") return parsed.savedAt;
      } catch {
        return null;
      }
    }
    return null;
  }

  getView(): ProviderSettingsView {
    return {
      provider: this.getConfig(),
      hasApiKey: this.apiKey !== null,
      apiKeyMasked: this.apiKey ? maskApiKey(this.apiKey) : null,
      apiKeySavedAt: this.apiKey !== null ? this.readSavedAt(this.getConfig().id) : null,
      credentialStorage: this.credentials.mode,
      credentialIssue: this.credentialIssue,
    };
  }

  /** 已保存配置列表（含每份配置的 Key 有无标记，不含任何密钥内容） */
  async listProfiles(): Promise<ProviderProfilesView> {
    const state = this.readProfilesState();
    const profiles = await Promise.all(
      state.profiles.map(async (config) => ({
        config,
        hasApiKey: await this.credentials.has(credentialKeyFor(config.id)),
        isActive: config.id === state.activeId,
      })),
    );
    return { activeId: state.activeId, profiles };
  }

  /** 切换激活配置：内存密钥缓存随之切到目标配置的凭据键 */
  async switchProfile(profileId: string): Promise<ProviderSettingsView> {
    const state = this.readProfilesState();
    const target = state.profiles.find((profile) => profile.id === profileId);
    if (!target) {
      throw new HttpError(404, "NOT_FOUND", "模型配置不存在");
    }

    state.activeId = target.id;
    this.writeProfilesState(state);
    this.upsertSetting(SETTINGS_KEY, JSON.stringify(target));
    await this.reloadActiveKey();
    return this.getView();
  }

  /** 把传入配置另存为新配置并激活；baseUrl 与原激活一致时复制其 API Key */
  async saveAsNewProfile(provider: unknown, name: string): Promise<ProviderSettingsView> {
    const trimmedName = readNonEmpty(name, "配置名称", 100);
    const source =
      typeof provider === "object" && provider !== null
        ? normalizeConfig(provider as Record<string, unknown>)
        : this.getConfig();

    const state = this.readProfilesState();
    if (state.profiles.some((profile) => profile.name === trimmedName)) {
      throw new HttpError(400, "INVALID_CONFIG", `已存在名为「${trimmedName}」的配置`);
    }

    const created: ProviderConfig = { ...source, id: randomUUID(), name: trimmedName };
    const previous = state.profiles.find((profile) => profile.id === state.activeId);

    if (previous && previous.baseUrl === created.baseUrl) {
      try {
        const key = await this.credentials.get(credentialKeyFor(previous.id));
        if (key && key.trim().length > 0) {
          await this.credentials.set(credentialKeyFor(created.id), key);
          const savedAt = this.readSavedAt(previous.id);
          if (savedAt !== null) {
            this.upsertSetting(
              credentialMetaKeyFor(created.id),
              JSON.stringify({ savedAt }),
            );
          }
        }
      } catch {
        throw new HttpError(
          500,
          "CREDENTIAL_STORE_FAILED",
          "API Key 写入本机凭据存储失败，请检查系统凭据服务后重试（配置本身未受影响）",
        );
      }
    }

    state.profiles.push(created);
    state.activeId = created.id;
    this.writeProfilesState(state);
    this.upsertSetting(SETTINGS_KEY, JSON.stringify(created));
    await this.reloadActiveKey();
    return this.getView();
  }

  /** 删除非激活配置及其凭据；激活中的配置必须先切换后再删 */
  async deleteProfile(profileId: string): Promise<ProviderProfilesView> {
    const state = this.readProfilesState();
    const target = state.profiles.find((profile) => profile.id === profileId);
    if (!target) {
      throw new HttpError(404, "NOT_FOUND", "模型配置不存在");
    }
    if (target.id === state.activeId) {
      throw new HttpError(400, "INVALID_CONFIG", "不能删除当前使用的配置，请先切换到其他配置");
    }

    try {
      await this.credentials.delete(credentialKeyFor(target.id));
    } catch {
      throw new HttpError(
        500,
        "CREDENTIAL_STORE_FAILED",
        "API Key 删除失败，请检查系统凭据服务后重试",
      );
    }
    this.db
      .prepare("DELETE FROM app_settings WHERE key = ?")
      .run(credentialMetaKeyFor(target.id));

    this.writeProfilesState({
      activeId: state.activeId,
      profiles: state.profiles.filter((profile) => profile.id !== target.id),
    });
    return this.listProfiles();
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

    // 配置列表 upsert：激活配置始终存在于列表中（首次保存自动纳入列表）
    const state = this.readProfilesState();
    const existingIndex = state.profiles.findIndex(
      (profile) => profile.id === provider.id,
    );
    if (existingIndex >= 0) state.profiles[existingIndex] = provider;
    else state.profiles.push(provider);
    state.activeId = provider.id;
    this.writeProfilesState(state);

    // provider_config 保留为激活配置的兼容镜像
    this.upsertSetting(SETTINGS_KEY, JSON.stringify(provider));

    const nextApiKey =
      typeof input.apiKey === "string" && input.apiKey.trim().length > 0
        ? input.apiKey.trim()
        : undefined;
    const credentialKey = credentialKeyFor(provider.id);

    try {
      if (input.clearApiKey) {
        // 删除失败必须报错，不谎报成功（内存状态保持不变）
        await this.credentials.delete(credentialKey);
        this.db
          .prepare("DELETE FROM app_settings WHERE key = ?")
          .run(credentialMetaKeyFor(provider.id));
        this.apiKey = null;
        this.credentialIssue = null;
      } else if (nextApiKey) {
        await this.credentials.set(credentialKey, nextApiKey);
        // 记录保存时间（仅时间，不含密钥信息），供脱敏视图展示
        this.upsertSetting(
          credentialMetaKeyFor(provider.id),
          JSON.stringify({ savedAt: updatedAt }),
        );
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
