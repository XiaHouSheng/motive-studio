import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import path from "node:path";
import type { CredentialStorageMode } from "@motive/shared";
import {
  CredentialStoreError,
  type CredentialStore,
} from "./credential-store.js";

const CREDENTIALS_FILE = "credentials.enc";
const KEY_FILE = "credentials.key";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/**
 * 本机加密文件凭据存储（显式降级方案）。
 *
 * AES-256-GCM 加密；随机 32 字节密钥保存在同目录的 credentials.key（0600）。
 * 安全性弱于系统凭据库（密钥文件与密文同目录，依赖文件系统权限隔离），
 * 仅用于系统凭据服务不可用的环境，绝不作为明文兜底。
 */
export class EncryptedFileCredentialStore implements CredentialStore {
  readonly mode: CredentialStorageMode = "encrypted-file";

  constructor(private readonly secretsDir: string) {}

  private get credentialsFile(): string {
    return path.join(this.secretsDir, CREDENTIALS_FILE);
  }

  private get keyFile(): string {
    return path.join(this.secretsDir, KEY_FILE);
  }

  private ensureDir(): void {
    mkdirSync(this.secretsDir, { recursive: true });
    try {
      chmodSync(this.secretsDir, 0o700);
    } catch {
      // Windows 文件系统不支持 POSIX 权限，忽略
    }
  }

  private loadOrCreateKey(): Buffer {
    if (existsSync(this.keyFile)) return this.readKey();
    const key = randomBytes(32);
    this.ensureDir();
    writeFileSync(this.keyFile, key, { mode: 0o600 });
    try {
      chmodSync(this.keyFile, 0o600);
    } catch {
      // 忽略非 POSIX 平台
    }
    return key;
  }

  private readKey(): Buffer {
    const key = readFileSync(this.keyFile);
    if (key.length !== 32) {
      throw new CredentialStoreError(
        "凭据加密密钥损坏，无法读取已保存的 API Key，请重新配置",
      );
    }
    return key;
  }

  private readEntries(): Record<string, string> | null {
    if (!existsSync(this.credentialsFile)) return null;
    try {
      const parsed = JSON.parse(
        readFileSync(this.credentialsFile, "utf8"),
      ) as { entries?: Record<string, string> };
      return parsed.entries ?? {};
    } catch {
      throw new CredentialStoreError(
        "凭据存储文件损坏，请重新配置 API Key",
      );
    }
  }

  private writeEntries(entries: Record<string, string>): void {
    this.ensureDir();
    const payload = JSON.stringify({ version: 1, entries }, null, 2);
    const tmp = `${this.credentialsFile}.tmp`;
    writeFileSync(tmp, payload, { mode: 0o600 });
    try {
      chmodSync(tmp, 0o600);
    } catch {
      // 忽略非 POSIX 平台
    }
    renameSync(tmp, this.credentialsFile);
  }

  private encrypt(key: Buffer, plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ciphertext]).toString("base64");
  }

  private decrypt(key: Buffer, blob: Buffer): string {
    if (blob.length <= IV_LENGTH + TAG_LENGTH) {
      throw new CredentialStoreError("凭据密文格式无效");
    }
    const iv = blob.subarray(0, IV_LENGTH);
    const tag = blob.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const ciphertext = blob.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new CredentialStoreError(
        "已保存的 API Key 解密失败（密文或密钥不匹配），请重新配置",
      );
    }
  }

  async get(key: string): Promise<string | null> {
    const entries = this.readEntries();
    const blob = entries?.[key];
    if (!blob) return null;
    const plaintext = this.decrypt(this.readKey(), Buffer.from(blob, "base64"));
    return plaintext.length > 0 ? plaintext : null;
  }

  async set(key: string, value: string): Promise<void> {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new CredentialStoreError("不能保存空的 API Key");
    }
    const keyBytes = this.loadOrCreateKey();
    const entries = this.readEntries() ?? {};
    entries[key] = this.encrypt(keyBytes, trimmed);
    this.writeEntries(entries);
  }

  async delete(key: string): Promise<void> {
    const entries = this.readEntries();
    if (!entries || !(key in entries)) return;
    delete entries[key];
    if (Object.keys(entries).length === 0) {
      rmSync(this.credentialsFile, { force: true });
      return;
    }
    this.writeEntries(entries);
  }

  async has(key: string): Promise<boolean> {
    const entries = this.readEntries();
    return entries !== null && key in entries;
  }
}
