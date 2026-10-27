import type { CredentialStorageMode } from "@motive/shared";

/**
 * 凭据存储统一抽象。
 *
 * 所有实现必须提供非明文的保护（系统凭据库或加密），并在不可用时抛出
 * CredentialStoreError，由调用方向用户明确反馈——绝不静默降级为明文存储。
 */
export interface CredentialStore {
  /** 存储模式标识（脱敏，供前端展示） */
  readonly mode: CredentialStorageMode;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
}

/** 凭据存储不可用或数据损坏时抛出；错误消息不得包含密钥明文或内部路径 */
export class CredentialStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialStoreError";
  }
}

export function isCredentialStoreError(
  error: unknown,
): error is CredentialStoreError {
  return error instanceof CredentialStoreError;
}
