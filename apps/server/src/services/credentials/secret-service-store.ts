import { spawn } from "node:child_process";
import type { CredentialStorageMode } from "@motive/shared";
import {
  CredentialStoreError,
  type CredentialStore,
} from "./credential-store.js";

const SERVICE_ATTR = "motive-studio";

/**
 * Linux Secret Service 凭据存储（GNOME Keyring / KWallet 的 D-Bus 标准接口，
 * 通过 libsecret 的 secret-tool CLI 访问）。
 */
export class SecretServiceCredentialStore implements CredentialStore {
  readonly mode: CredentialStorageMode = "secret-service";

  async get(key: string): Promise<string | null> {
    const output = await this.runTool(
      ["lookup", "service", SERVICE_ATTR, "account", key],
      undefined,
    );
    const trimmed = output.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  async set(key: string, value: string): Promise<void> {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new CredentialStoreError("不能保存空的 API Key");
    }
    await this.runTool(
      [
        "store",
        "--label=Motive Studio API Key",
        "service",
        SERVICE_ATTR,
        "account",
        key,
      ],
      trimmed,
    );
  }

  async delete(key: string): Promise<void> {
    await this.runTool(["clear", "service", SERVICE_ATTR, "account", key]);
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== null;
  }

  private async runTool(
    args: string[],
    input?: string,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn("secret-tool", args, {
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", () => {
        reject(
          new CredentialStoreError(
            "系统密钥服务（secret-tool）不可用，无法读写 API Key",
          ),
        );
      });
      child.on("close", (code) => {
        if (code === 0) resolve(stdout);
        else reject(new CredentialStoreError(`系统密钥服务调用失败（退出码 ${code}）`));
      });
      if (input !== undefined) {
        child.stdin.write(input);
        child.stdin.end();
      }
    });
  }
}
