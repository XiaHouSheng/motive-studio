export type ProviderProtocol = "openai-chat-completions";

export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  protocol: ProviderProtocol;
  temperature?: number;
  maxTokens?: number;
}

export interface ProviderSettingsView {
  provider: ProviderConfig;
  hasApiKey: boolean;
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
