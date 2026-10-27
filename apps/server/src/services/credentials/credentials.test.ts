import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import type { CredentialStorageMode, ProviderSettingsView } from "@motive/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { openDatabase } from "../../db/client.js";
import { ProviderSettingsStore } from "../ai/provider-settings-store.js";
import {
  createCredentialStore,
  CredentialStoreError,
  EncryptedFileCredentialStore,
  WindowsDpapiCredentialStore,
} from "./index.js";

const API_KEY = "sk-secret-e2e-9f8a7b6c5d4e3210";
const VALID_MODES: CredentialStorageMode[] = [
  "dpapi",
  "keychain",
  "secret-service",
  "encrypted-file",
];

const PROVIDER = {
  id: "default",
  name: "Test Provider",
  baseUrl: "http://127.0.0.1:9/v1",
  model: "test-model",
  protocol: "openai-chat-completions",
};

interface RunningApp {
  baseUrl: string;
  app: ReturnType<typeof createApp>;
  close: () => Promise<void>;
}

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(path.join(tmpdir(), "motive-credentials-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("未获得端口");
  return address.port;
}

async function startApp(dbPath: string): Promise<RunningApp> {
  const app = createApp({ dbPath, uploadsDir: path.join(path.dirname(dbPath), "uploads") });
  const server = app.listen(0, "127.0.0.1");
  const port = await listen(server);

  let closed = false;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    app,
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      (app.locals.db as DatabaseSync).close();
    },
  };
}

/** 模拟 index.ts 启动时的密钥恢复（测试绕过了 index.ts，需手动触发） */
async function restoreSettings(app: ReturnType<typeof createApp>): Promise<void> {
  await (app.locals.settingsStore as ProviderSettingsStore).restore();
}

async function getProvider(app: RunningApp): Promise<ProviderSettingsView> {
  const response = await fetch(`${app.baseUrl}/api/settings/provider`);
  expect(response.status).toBe(200);
  return (await response.json()) as ProviderSettingsView;
}

async function putProvider(
  app: RunningApp,
  extra: { apiKey?: string; clearApiKey?: boolean },
): Promise<ProviderSettingsView> {
  const response = await fetch(`${app.baseUrl}/api/settings/provider`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: PROVIDER, ...extra }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as ProviderSettingsView;
}

/** 递归读取目录下所有文件的文本内容（用于断言无明文泄漏） */
function readAllFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...readAllFiles(full));
    else out.push(readFileSync(full, "utf8"));
  }
  return out;
}

describe("EncryptedFileCredentialStore", () => {
  it("set/get/has/delete roundtrip，清空后凭据文件被清理", async () => {
    const secretsDir = path.join(workDir, "secrets");
    const store = new EncryptedFileCredentialStore(secretsDir);

    expect(await store.get("k1")).toBeNull();
    expect(await store.has("k1")).toBe(false);

    await store.set("k1", API_KEY);
    expect(await store.has("k1")).toBe(true);
    expect(await store.get("k1")).toBe(API_KEY);

    // 多个键互不影响
    await store.set("k2", "another-key");
    expect(await store.get("k2")).toBe("another-key");
    expect(await store.get("k1")).toBe(API_KEY);

    await store.delete("k1");
    expect(await store.has("k1")).toBe(false);
    expect(await store.get("k1")).toBeNull();
    // 删除最后一个键后凭据文件被移除
    await store.delete("k2");
    expect(existsSync(path.join(secretsDir, "credentials.enc"))).toBe(false);
  });

  it("重复删除不存在的键是 no-op", async () => {
    const store = new EncryptedFileCredentialStore(path.join(workDir, "secrets"));
    await expect(store.delete("missing")).resolves.toBeUndefined();
  });

  it("拒绝保存空值", async () => {
    const store = new EncryptedFileCredentialStore(path.join(workDir, "secrets"));
    await expect(store.set("k1", "   ")).rejects.toBeInstanceOf(CredentialStoreError);
  });

  it("磁盘文件不含密钥明文", async () => {
    const secretsDir = path.join(workDir, "secrets");
    const store = new EncryptedFileCredentialStore(secretsDir);
    await store.set("k1", API_KEY);
    await store.set("k2", "another-key");
    for (const content of readAllFiles(secretsDir)) {
      expect(content.includes(API_KEY)).toBe(false);
      expect(content.includes("another-key")).toBe(false);
    }
  });

  it("凭据文件损坏时抛 CredentialStoreError", async () => {
    const secretsDir = path.join(workDir, "secrets");
    const store = new EncryptedFileCredentialStore(secretsDir);
    await store.set("k1", API_KEY);
    writeFileSync(path.join(secretsDir, "credentials.enc"), "{not-json", "utf8");
    await expect(store.get("k1")).rejects.toBeInstanceOf(CredentialStoreError);
  });

  it("密文被篡改时解密失败抛 CredentialStoreError", async () => {
    const secretsDir = path.join(workDir, "secrets");
    const store = new EncryptedFileCredentialStore(secretsDir);
    await store.set("k1", API_KEY);

    const file = path.join(secretsDir, "credentials.enc");
    const parsed = JSON.parse(readFileSync(file, "utf8")) as {
      entries: Record<string, string>;
    };
    const blob = Buffer.from(parsed.entries.k1, "base64");
    const last = blob.length - 1;
    blob[last] = (blob[last] ?? 0) ^ 0xff;
    writeFileSync(
      file,
      JSON.stringify({ version: 1, entries: { k1: blob.toString("base64") } }),
    );

    await expect(store.get("k1")).rejects.toBeInstanceOf(CredentialStoreError);
  });

  it("密钥文件被替换时解密失败抛 CredentialStoreError", async () => {
    const secretsDir = path.join(workDir, "secrets");
    const store = new EncryptedFileCredentialStore(secretsDir);
    await store.set("k1", API_KEY);
    writeFileSync(path.join(secretsDir, "credentials.key"), randomBytes(32));
    await expect(store.get("k1")).rejects.toBeInstanceOf(CredentialStoreError);
  });
});

describe.skipIf(process.platform !== "win32")("WindowsDpapiCredentialStore", () => {
  it("DPAPI roundtrip，blob 文件不含明文", async () => {
    const secretsDir = path.join(workDir, "secrets");
    const store = new WindowsDpapiCredentialStore(secretsDir);

    await store.set("k1", API_KEY);
    expect(await store.has("k1")).toBe(true);
    expect(await store.get("k1")).toBe(API_KEY);
    for (const content of readAllFiles(secretsDir)) {
      expect(content.includes(API_KEY)).toBe(false);
    }

    await store.delete("k1");
    expect(await store.has("k1")).toBe(false);
    expect(await store.get("k1")).toBeNull();
    // 重复删除是 no-op
    await expect(store.delete("k1")).resolves.toBeUndefined();
  });
});

describe("createCredentialStore", () => {
  it("返回当前平台可用的非明文存储", () => {
    const store = createCredentialStore(path.join(workDir, "secrets"));
    expect(VALID_MODES).toContain(store.mode);
    if (process.platform === "win32") {
      expect(store.mode).toBe("dpapi");
    }
  });
});

describe("ProviderSettingsStore 恢复失败兜底", () => {
  it("凭据解密失败时置空密钥并给出 credentialIssue", async () => {
    const db = openDatabase(path.join(workDir, "store.db"));
    const secretsDir = path.join(workDir, "store-secrets");
    const store = new ProviderSettingsStore(
      db,
      new EncryptedFileCredentialStore(secretsDir),
    );
    await store.save({ provider: PROVIDER, apiKey: API_KEY });
    expect(store.getView().hasApiKey).toBe(true);

    // 破坏凭据文件，模拟密文损坏
    writeFileSync(path.join(secretsDir, "credentials.enc"), "corrupted", "utf8");

    const next = new ProviderSettingsStore(
      db,
      new EncryptedFileCredentialStore(secretsDir),
    );
    await next.restore();
    const view = next.getView();
    expect(view.hasApiKey).toBe(false);
    expect(view.credentialIssue).not.toBeNull();
    expect(next.getApiKey()).toBeNull();
    db.close();
  });
});

describe("凭据持久化 HTTP 闭环", () => {
  it("保存密钥后重启自动恢复，响应与磁盘均无明文", async () => {
    const dbPath = path.join(workDir, "data", "app.db");
    const secretsDir = path.join(workDir, "data", "secrets");

    // 1. 首次启动：保存密钥
    const first = await startApp(dbPath);
    const saved = await putProvider(first, { apiKey: API_KEY });
    expect(saved.hasApiKey).toBe(true);
    expect(saved.credentialIssue).toBeNull();
    expect(VALID_MODES).toContain(saved.credentialStorage);
    expect(JSON.stringify(saved).includes(API_KEY)).toBe(false);

    // secrets 目录与 sqlite 配置均不含明文
    for (const content of readAllFiles(secretsDir)) {
      expect(content.includes(API_KEY)).toBe(false);
    }
    const row = (first.app.locals.db as DatabaseSync)
      .prepare("SELECT value FROM app_settings WHERE key = 'provider_config'")
      .get() as { value: string };
    expect(row.value.includes(API_KEY)).toBe(false);
    await first.close();

    // 2. 重启：同路径重建 app，执行启动恢复后密钥可用
    const second = await startApp(dbPath);
    await restoreSettings(second.app);
    const restored = await getProvider(second);
    expect(restored.hasApiKey).toBe(true);
    expect(restored.credentialIssue).toBeNull();
    // 内存缓存可供 AI 路由同步读取
    expect((second.app.locals.settingsStore as ProviderSettingsStore).getApiKey()).toBe(API_KEY);

    // 3. 清除密钥 → 重启后仍为已清除
    const cleared = await putProvider(second, { clearApiKey: true });
    expect(cleared.hasApiKey).toBe(false);
    await second.close();

    const third = await startApp(dbPath);
    await restoreSettings(third.app);
    expect((await getProvider(third)).hasApiKey).toBe(false);
    await third.close();
  });
});
