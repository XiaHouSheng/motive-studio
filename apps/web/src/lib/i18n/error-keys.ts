import type { DictionaryKey } from "./zh-CN";

/**
 * API 错误码 → 词条映射：显示层优先按 code 取词条；
 * 未映射的错误码保留服务端原始消息（未知错误不强行翻译）。
 */
const ERROR_KEYS: Record<string, DictionaryKey> = {
  REQUEST_FAILED: "error.REQUEST_FAILED",
  NETWORK_ERROR: "error.NETWORK_ERROR",
  CANCELLED: "error.CANCELLED",
  INVALID_CONFIG: "error.INVALID_CONFIG",
  INVALID_FIELD: "error.INVALID_FIELD",
  INVALID_PARAM: "error.INVALID_PARAM",
  INVALID_BODY: "error.INVALID_BODY",
  NOT_FOUND: "error.NOT_FOUND",
  UNAUTHORIZED: "error.UNAUTHORIZED",
  AUTH_FAILED: "error.AUTH_FAILED",
  RATE_LIMITED: "error.RATE_LIMITED",
  PROVIDER_ERROR: "error.PROVIDER_ERROR",
  MODEL_NOT_FOUND: "error.MODEL_NOT_FOUND",
  INVALID_RESPONSE: "error.INVALID_RESPONSE",
  SCHEMA_VALIDATION_FAILED: "error.SCHEMA_VALIDATION_FAILED",
  NO_STEPS: "error.NO_STEPS",
  VISION_UNSUPPORTED: "error.VISION_UNSUPPORTED",
  CREDENTIAL_STORE_FAILED: "error.CREDENTIAL_STORE_FAILED",
};

export function errorCodeToKey(code: string): DictionaryKey | undefined {
  return ERROR_KEYS[code];
}
