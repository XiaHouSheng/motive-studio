import { HttpError } from "../http-error.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * 移动端访问凭证：桌面端生成 UUID key 注册，服务端发放 token。
 * 凭证保存在内存中，服务重启即失效。
 */
export class MobileSessionStore {
  private sessions = new Map<string, number>();

  /** 注册一个桌面端生成的 key，返回访问 token。 */
  register(rawKey: unknown): string {
    if (typeof rawKey !== "string" || !UUID_PATTERN.test(rawKey.trim())) {
      throw new HttpError(400, "INVALID_FIELD", "key 必须是有效的 UUID");
    }
    const key = rawKey.trim().toLowerCase();
    this.cleanup();
    // key 即 token：仅在注册时由本机回环提交，且格式受 UUID 校验约束
    this.sessions.set(key, Date.now());
    return key;
  }

  validate(token: string | undefined | null): boolean {
    if (!token) return false;
    const createdAt = this.sessions.get(token.toLowerCase());
    if (createdAt === undefined) return false;
    if (Date.now() - createdAt > SESSION_TTL_MS) {
      this.sessions.delete(token.toLowerCase());
      return false;
    }
    return true;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [token, createdAt] of this.sessions) {
      if (now - createdAt > SESSION_TTL_MS) this.sessions.delete(token);
    }
  }
}
