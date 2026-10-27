import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { CredentialStorageMode } from "@motive/shared";
import {
  CredentialStoreError,
  type CredentialStore,
} from "./credential-store.js";

const CREDENTIALS_FILE = "credentials.json";

/**
 * Windows DPAPI（CurrentUser 范围）凭据存储。
 *
 * 通过 PowerShell [System.Security.Cryptography.ProtectedData] 完成加解密：
 * 密钥由 Windows 按当前用户派生，密文以 base64 存放在 secretsDir/credentials.json，
 * 其他 Windows 用户与未授权进程无法解密。全程以 base64 经 stdin/stdout 管道传输，
 * 避免编码与命令行注入问题。
 */
export class WindowsDpapiCredentialStore implements CredentialStore {
  readonly mode: CredentialStorageMode = "dpapi";

  constructor(private readonly secretsDir: string) {}

  private get credentialsFile(): string {
    return path.join(this.secretsDir, CREDENTIALS_FILE);
  }

  private readEntries(): Record<string, string> | null {
    if (!existsSync(this.credentialsFile)) return null;
    try {
      const parsed = JSON.parse(
        readFileSync(this.credentialsFile, "utf8"),
      ) as { entries?: Record<string, string> };
      return parsed.entries ?? {};
    } catch {
      throw new CredentialStoreError("凭据存储文件损坏，请重新配置 API Key");
    }
  }

  private writeEntries(entries: Record<string, string>): void {
    mkdirSync(this.secretsDir, { recursive: true });
    const tmp = `${this.credentialsFile}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, entries }, null, 2));
    renameSync(tmp, this.credentialsFile);
  }

  async get(key: string): Promise<string | null> {
    const entries = this.readEntries();
    const blob = entries?.[key];
    if (!blob) return null;
    const plainB64 = await runDpapi(UNPROTECT_SCRIPT, blob);
    return Buffer.from(plainB64, "base64").toString("utf8");
  }

  async set(key: string, value: string): Promise<void> {
    const trimmed = value.trim();
    if (!trimmed) {
      throw new CredentialStoreError("不能保存空的 API Key");
    }
    const blob = await runDpapi(
      PROTECT_SCRIPT,
      Buffer.from(trimmed, "utf8").toString("base64"),
    );
    const entries = this.readEntries() ?? {};
    entries[key] = blob;
    this.writeEntries(entries);
  }

  async delete(key: string): Promise<void> {
    const entries = this.readEntries();
    if (!entries || !(key in entries)) return;
    delete entries[key];
    this.writeEntries(entries);
  }

  async has(key: string): Promise<boolean> {
    const entries = this.readEntries();
    return entries !== null && key in entries;
  }
}

const PROTECT_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$payload = [Console]::In.ReadToEnd().Trim()
$bytes = [Convert]::FromBase64String($payload)
$protected = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($protected))
`;

const UNPROTECT_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$payload = [Console]::In.ReadToEnd().Trim()
$bytes = [Convert]::FromBase64String($payload)
$plain = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($plain))
`;

function runDpapi(script: string, stdinBase64: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        script,
      ],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", () => {
      reject(new CredentialStoreError("无法启动 PowerShell，Windows 凭据保护不可用"));
    });
    child.on("close", (code) => {
      if (code === 0 && stdout.trim().length > 0) {
        resolve(stdout.trim());
        return;
      }
      // 解密失败（如换 Windows 用户）等情况：不使用损坏数据
      reject(
        new CredentialStoreError(
          "Windows 凭据保护调用失败，已保存的 API Key 无法解密，请重新配置" +
            (stderr.trim() ? `（${stderr.trim().slice(0, 200)}）` : ""),
        ),
      );
    });

    child.stdin.write(stdinBase64);
    child.stdin.end();
  });
}
