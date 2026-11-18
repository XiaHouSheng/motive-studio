import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { RemoteAccessView } from "@motive/shared";
import { HttpError } from "../http-error.js";
import type { CredentialStore } from "./credentials/credential-store.js";

const SETTINGS_KEY = "remote_access";
const CREDENTIAL_KEY = "remote_access:token";
const FRPS_CREDENTIAL_KEY = "remote_access:frps_token";

/** 远程接入配置（app_settings KV 键 remote_access） */
export interface RemoteAccessConfig {
  /** 启用后：非本机请求必须携带访问密钥（桌面版同时启动内嵌 frpc 广播） */
  enabled: boolean;
  /** 公网入口 origin（如 https://motive.example.duckdns.org:39222）；空串表示未配置 */
  publicOrigin: string;
  /** frps 服务器地址（IP 或域名，不含端口；控制通道端口固定 39220） */
  serverAddr: string;
}

/** 归一化 frps 服务器地址：接受裸 IP/域名，或粘贴带协议/端口的地址时仅取主机名 */
export function parseServerAddr(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpError(400, "INVALID_FIELD", "serverAddr 必须是字符串");
  }
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `//${trimmed}`, "http://placeholder.invalid");
    if (!url.hostname) return "";
    return url.hostname;
  } catch {
    throw new HttpError(400, "INVALID_FIELD", "serverAddr 不是合法的 IP 或域名");
  }
}

// 状态视图类型以 @motive/shared 为准（含 frpsTokenSet / frpc 等字段）
export type { RemoteAccessView };

function parsePublicOrigin(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpError(400, "INVALID_FIELD", "publicOrigin 必须是字符串");
  }
  const trimmed = value.trim();
  if (!trimmed) return "";
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new HttpError(400, "INVALID_FIELD", "publicOrigin 必须是合法 URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new HttpError(400, "INVALID_FIELD", "publicOrigin 必须是 http/https 地址");
  }
  if (url.pathname !== "" && url.pathname !== "/") {
    throw new HttpError(400, "INVALID_FIELD", "publicOrigin 只需协议与域名（端口），不能包含路径");
  }
  if (url.search || url.hash) {
    throw new HttpError(400, "INVALID_FIELD", "publicOrigin 不能包含查询参数或锚点");
  }
  return url.origin;
}

/**
 * 远程接入存储：配置在 SQLite app_settings（键 remote_access），
 * 访问密钥在 CredentialStore（键 remote_access:token，按平台加密落盘 data/secrets）。
 * 门卫激活条件 = enabled 且已生成密钥；密钥缓存于内存，轮换/吊销即时生效。
 */
export class RemoteAccessStore {
  private readonly db: DatabaseSync;
  private readonly credentials: CredentialStore;
  /** undefined 表示尚未从凭据库加载；null 表示未生成 */
  private cachedToken: string | null | undefined;
  private cachedFrpsToken: string | null | undefined;

  constructor(db: DatabaseSync, credentials: CredentialStore) {
    this.db = db;
    this.credentials = credentials;
  }

  getConfig(): RemoteAccessConfig {
    const row = this.db
      .prepare("SELECT value FROM app_settings WHERE key = ?")
      .get(SETTINGS_KEY) as { value: string } | undefined;
    if (!row) return { enabled: false, publicOrigin: "", serverAddr: "" };
    try {
      const parsed = JSON.parse(row.value) as Record<string, unknown>;
      return {
        enabled: parsed.enabled === true,
        publicOrigin: typeof parsed.publicOrigin === "string" ? parsed.publicOrigin : "",
        serverAddr: typeof parsed.serverAddr === "string" ? parsed.serverAddr : "",
      };
    } catch {
      return { enabled: false, publicOrigin: "", serverAddr: "" };
    }
  }

  /** 部分更新：只覆盖明确提供的字段；先整体校验再写库，整次更新原子生效 */
  saveConfig(input: Record<string, unknown>): RemoteAccessConfig {
    const next = this.getConfig();
    if ("enabled" in input) {
      if (typeof input.enabled !== "boolean") {
        throw new HttpError(400, "INVALID_FIELD", "enabled 必须是布尔值");
      }
      next.enabled = input.enabled;
    }
    if ("publicOrigin" in input) {
      next.publicOrigin = parsePublicOrigin(input.publicOrigin);
    }
    if ("serverAddr" in input) {
      next.serverAddr = parseServerAddr(input.serverAddr);
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

  async getView(): Promise<RemoteAccessView> {
    const [token, frpsToken] = await Promise.all([this.getToken(), this.getFrpsToken()]);
    return {
      ...this.getConfig(),
      hasToken: token !== null,
      frpsTokenSet: frpsToken !== null,
    };
  }

  async getFrpsToken(): Promise<string | null> {
    if (this.cachedFrpsToken !== undefined) return this.cachedFrpsToken;
    this.cachedFrpsToken = await this.credentials.get(FRPS_CREDENTIAL_KEY);
    return this.cachedFrpsToken;
  }

  /** 保存/更新 frps 认证令牌（frpc 连 frps 用，与访问密钥无关） */
  async setFrpsToken(token: string): Promise<void> {
    await this.credentials.set(FRPS_CREDENTIAL_KEY, token);
    this.cachedFrpsToken = token;
  }

  async getToken(): Promise<string | null> {
    if (this.cachedToken !== undefined) return this.cachedToken;
    this.cachedToken = await this.credentials.get(CREDENTIAL_KEY);
    return this.cachedToken;
  }

  /** 生成/轮换密钥：旧密钥立即失效 */
  async rotateToken(): Promise<string> {
    const token = randomBytes(24).toString("base64url");
    await this.credentials.set(CREDENTIAL_KEY, token);
    this.cachedToken = token;
    return token;
  }

  /** 吊销密钥：门卫随之关闭 */
  async clearToken(): Promise<void> {
    await this.credentials.delete(CREDENTIAL_KEY);
    this.cachedToken = null;
  }

  /** 常量时间比较：先做 SHA-256 归一，避免长度与逐字节时序泄漏 */
  async verify(candidate: string): Promise<boolean> {
    if (!candidate) return false;
    const token = await this.getToken();
    if (!token) return false;
    const left = createHash("sha256").update(candidate).digest();
    const right = createHash("sha256").update(token).digest();
    return timingSafeEqual(left, right);
  }
}
