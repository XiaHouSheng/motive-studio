export type ProviderProtocol = "openai-chat-completions";

export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  protocol: ProviderProtocol;
  temperature?: number;
  maxTokens?: number;
  /** 是否支持图片输入，默认 true */
  supportsVision?: boolean;
}

/**
 * 凭据存储模式：
 * - dpapi / keychain / secret-service：操作系统级凭据保护
 * - encrypted-file：本机 AES-256-GCM 加密文件（系统凭据库不可用时的显式降级方案）
 */
export type CredentialStorageMode =
  | "dpapi"
  | "keychain"
  | "secret-service"
  | "encrypted-file";

export interface ProviderSettingsView {
  provider: ProviderConfig;
  hasApiKey: boolean;
  /** 已保存密钥的脱敏预览（前 3 位 + 末 4 位，无明文）；未保存或无法解密时为 null */
  apiKeyMasked: string | null;
  /** 当前密钥的保存时间（epoch ms）；未保存或早期保存未记录时为 null */
  apiKeySavedAt: number | null;
  /** 密钥在本机的存储方式（脱敏，不含任何路径） */
  credentialStorage: CredentialStorageMode;
  /** 凭据存储异常提示（如解密失败需要重新配置）；正常为 null */
  credentialIssue: string | null;
}

export interface ProviderSettingsUpdate {
  provider: ProviderConfig;
  apiKey?: string;
  clearApiKey?: boolean;
}

export interface ProviderTestResult {
  ok: true;
  model: string;
  latencyMs: number;
}

export type AIErrorCode =
  | "INVALID_CONFIG"
  | "AUTH_FAILED"
  | "RATE_LIMITED"
  | "NETWORK_ERROR"
  | "PROVIDER_ERROR"
  | "MODEL_NOT_FOUND"
  | "INVALID_RESPONSE"
  | "SCHEMA_VALIDATION_FAILED"
  | "CANCELLED";

export type ChatRole = "system" | "user" | "assistant";

/** 多模态内容片段，形状对齐 OpenAI chat completions 的 content 数组 */
export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: ChatRole;
  content: string | ChatContentPart[];
}

export type ChatStreamEvent =
  | { type: "text-delta"; text: string }
  | { type: "usage"; inputTokens?: number; outputTokens?: number }
  | { type: "completed"; finishReason?: string }
  | { type: "error"; code: AIErrorCode; message: string };
