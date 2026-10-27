import type { AIErrorCode } from "@motive/shared";
import { HttpError } from "../../http-error.js";

export class AIError extends Error {
  readonly code: AIErrorCode;
  readonly status?: number;

  constructor(code: AIErrorCode, message: string, status?: number) {
    super(message);
    this.name = "AIError";
    this.code = code;
    this.status = status;
  }
}

const HTTP_STATUS_BY_CODE: Record<AIErrorCode, number> = {
  INVALID_CONFIG: 400,
  AUTH_FAILED: 401,
  RATE_LIMITED: 429,
  NETWORK_ERROR: 502,
  PROVIDER_ERROR: 502,
  MODEL_NOT_FOUND: 404,
  INVALID_RESPONSE: 502,
  SCHEMA_VALIDATION_FAILED: 400,
  CANCELLED: 408,
};

export function toHttpError(error: unknown): HttpError {
  if (error instanceof AIError) {
    return new HttpError(HTTP_STATUS_BY_CODE[error.code], error.code, error.message);
  }
  return new HttpError(500, "INTERNAL_ERROR", "模型服务调用失败");
}

export function mapUpstreamStatus(status: number): AIErrorCode {
  if (status === 401 || status === 403) return "AUTH_FAILED";
  if (status === 404) return "MODEL_NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "PROVIDER_ERROR";
  return "PROVIDER_ERROR";
}
