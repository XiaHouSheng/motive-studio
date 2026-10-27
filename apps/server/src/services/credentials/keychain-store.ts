import { spawn } from "node:child_process";
import type { CredentialStorageMode } from "@motive/shared";
import {
  CredentialStoreError,
  type CredentialStore,
} from "./credential-store.js";

const SERVICE = "Motive Studio";

/**
 * macOS 钥匙串凭据存储（security CLI，generic password）。
 *
 * 密钥值以 base64 编码后作为 password 写入，避免特殊字符与编码问题；
 * 读取、删除通过 service + account 精确定位条目。
 */
export class MacKeychainCredentialStore implements CredentialStore {
  readonly mode: CredentialStorageMode = "keychain";

  async get(key: string): Promise<string | null> {
    try {
      const output = await runSecurity([
        "find-generic-password",
        "-s",
        SERVICE,
        "-a",
        key,
        "-w",
      ]);
      return Buffer.from(output.trim(), "base64").toString("utf8");
    } catch (error) {
      if (isNotFound(error)) return null;
      throw new CredentialStoreError(
        "读取 macOS 钥匙串中的 API Key 失败，请重新配置",
      );
    }
  }

  async set(key: string, value: string): Promise<void> {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new CredentialStoreError("不能保存空的 API Key");
    }
    const encoded = Buffer.from(trimmed, "utf8").toString("base64");
    try {
      // -U 表示存在即更新（upsert）
      await runSecurity([
        "add-generic-password",
        "-U",
        "-s",
        SERVICE,
        "-a",
        key,
        "-w",
        encoded,
      ]);
    } catch {
      throw new CredentialStoreError("写入 macOS 钥匙串失败，API Key 未保存");
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await runSecurity([
        "delete-generic-password",
        "-s",
        SERVICE,
        "-a",
        key,
      ]);
    } catch (error) {
      if (isNotFound(error)) return;
      throw new CredentialStoreError("从 macOS 钥匙串删除 API Key 失败");
    }
  }

  async has(key: string): Promise<boolean> {
    try {
      await runSecurity(["find-generic-password", "-s", SERVICE, "-a", key]);
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw new CredentialStoreError("访问 macOS 钥匙串失败");
    }
  }
}

function runSecurity(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("security", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `security 退出码 ${code}`));
    });
  });
}

/** security CLI 找不到条目时退出码为 44，属于正常业务分支而非错误 */
function isNotFound(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("could not be found") ||
      error.message.includes("exit code 44") ||
      error.message.includes("退出码 44"))
  );
}
