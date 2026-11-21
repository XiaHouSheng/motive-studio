import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ProviderProfilesView, ProviderSettingsView } from "@motive/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { maskApiKey, ProviderSettingsStore } from "./services/ai/provider-settings-store.js";
import { createCredentialStore } from "./services/credentials/index.js";

interface RunningApp {
  baseUrl: string;
  dbPath: string;
  secretsDir: string;
  db: DatabaseSync;
  close: () => Promise<void>;
}

async function start(dbPath: string): Promise<RunningApp> {
  const secretsDir = path.join(path.dirname(dbPath), "secrets");
  const app = createApp({ dbPath, uploadsDir: path.join(path.dirname(dbPath), "uploads") });
  const server: Server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("测试服务器未获得端口");
  }

  let closed = false;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    dbPath,
    secretsDir,
    db: app.locals.db as DatabaseSync,
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

async function call<T>(
  running: RunningApp,
  method: string,
  route: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const response = await fetch(`${running.baseUrl}${route}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : undefined) as T };
}

const BASE_URL_A = "https://api.provider-a.example/v1";
const BASE_URL_B = "https://api.provider-b.example/v1";
const KEY_A = "sk-key-aaaa-bbbb-cccc";
const KEY_B = "sk-key-dddd-eeee-ffff";

function providerInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "default",
    name: "服务商 A",
    baseUrl: BASE_URL_A,
    model: "model-a",
    protocol: "openai-chat-completions",
    ...overrides,
  };
}

describe("模型配置（profile）管理", () => {
  let dir: string;
  let running: RunningApp;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "motive-profiles-test-"));
    running = await start(path.join(dir, "motive.db"));
  });

  afterEach(async () => {
    await running.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("首次读取时把默认配置纳入列表", async () => {
    const list = await call<ProviderProfilesView>(running, "GET", "/api/settings/provider/profiles");
    expect(list.status).toBe(200);
    expect(list.body.activeId).toBe("default");
    expect(list.body.profiles).toHaveLength(1);
    expect(list.body.profiles[0]?.config.id).toBe("default");
    expect(list.body.profiles[0]?.isActive).toBe(true);
    expect(list.body.profiles[0]?.hasApiKey).toBe(false);
  });

  it("另存新配置激活它；同地址复制 Key，跨地址不复制", async () => {
    // 保存默认配置 + Key
    const saved = await call<ProviderSettingsView>(running, "PUT", "/api/settings/provider", {
      provider: providerInput(),
      apiKey: KEY_A,
    });
    expect(saved.status).toBe(200);
    expect(saved.body.hasApiKey).toBe(true);

    // 同地址另存：Key 被复制
    const copied = await call<ProviderSettingsView>(running, "POST", "/api/settings/provider/profiles", {
      name: "服务商 A 备用模型",
      provider: providerInput({ model: "model-a2" }),
    });
    expect(copied.status).toBe(200);
    expect(copied.body.provider.model).toBe("model-a2");
    expect(copied.body.provider.id).not.toBe("default");
    expect(copied.body.hasApiKey).toBe(true);
    expect(copied.body.apiKeyMasked).toBe(maskApiKey(KEY_A));

    // 跨地址另存：不复制 Key
    const fresh = await call<ProviderSettingsView>(running, "POST", "/api/settings/provider/profiles", {
      name: "服务商 B",
      provider: providerInput({ baseUrl: BASE_URL_B, model: "model-b" }),
    });
    expect(fresh.status).toBe(200);
    expect(fresh.body.hasApiKey).toBe(false);

    const list = await call<ProviderProfilesView>(running, "GET", "/api/settings/provider/profiles");
    expect(list.body.profiles).toHaveLength(3);
    expect(list.body.profiles.filter((profile) => profile.isActive)).toHaveLength(1);
    expect(list.body.activeId).toBe(fresh.body.provider.id);
    expect(
      list.body.profiles.find((profile) => profile.config.name === "服务商 A 备用模型")
        ?.hasApiKey,
    ).toBe(true);
    expect(
      list.body.profiles.find((profile) => profile.config.name === "服务商 B")?.hasApiKey,
    ).toBe(false);
  });

  it("切换配置后各配置读取各自的 Key", async () => {
    const saved = await call<ProviderSettingsView>(running, "PUT", "/api/settings/provider", {
      provider: providerInput(),
      apiKey: KEY_A,
    });
    const profileAId = saved.body.provider.id;
    expect(profileAId).toBe("default");

    const created = await call<ProviderSettingsView>(running, "POST", "/api/settings/provider/profiles", {
      name: "服务商 B",
      provider: providerInput({ baseUrl: BASE_URL_B, model: "model-b" }),
    });
    const profileBId = created.body.provider.id;

    // 给 B 配置独立 Key（保存配置即激活该配置）
    const savedB = await call<ProviderSettingsView>(running, "PUT", "/api/settings/provider", {
      provider: providerInput({
        id: profileBId,
        name: "服务商 B",
        baseUrl: BASE_URL_B,
        model: "model-b",
      }),
      apiKey: KEY_B,
    });
    expect(savedB.body.hasApiKey).toBe(true);
    expect(savedB.body.provider.model).toBe("model-b");

    // 切回 A：模型与 Key 恢复为 A 的
    const backToA = await call<ProviderSettingsView>(
      running,
      "POST",
      "/api/settings/provider/profiles/switch",
      { profileId: profileAId },
    );
    expect(backToA.status).toBe(200);
    expect(backToA.body.provider.model).toBe("model-a");
    expect(backToA.body.apiKeyMasked).toBe(maskApiKey(KEY_A));

    // 再切到 B：模型与 Key 变为 B 的
    const backToB = await call<ProviderSettingsView>(
      running,
      "POST",
      "/api/settings/provider/profiles/switch",
      { profileId: profileBId },
    );
    expect(backToB.body.provider.model).toBe("model-b");
    expect(backToB.body.apiKeyMasked).toBe(maskApiKey(KEY_B));

    // 不存在的配置返回 404
    const missing = await call<{ code: string }>(
      running,
      "POST",
      "/api/settings/provider/profiles/switch",
      { profileId: "not-exists" },
    );
    expect(missing.status).toBe(404);
  });

  it("删除配置：激活中的禁删，非激活连同 Key 一并删除", async () => {
    const saved = await call<ProviderSettingsView>(running, "PUT", "/api/settings/provider", {
      provider: providerInput(),
      apiKey: KEY_A,
    });
    const profileAId = saved.body.provider.id;
    const created = await call<ProviderSettingsView>(running, "POST", "/api/settings/provider/profiles", {
      name: "服务商 B",
      provider: providerInput({ baseUrl: BASE_URL_B, model: "model-b" }),
    });
    const profileBId = created.body.provider.id;

    // 激活中的 A（当前 active 是 B？另存后激活 B）……先确认当前激活是 B
    expect(created.body.provider.id).toBe(profileBId);
    const rejected = await call<{ code: string }>(
      running,
      "DELETE",
      `/api/settings/provider/profiles/${profileBId}`,
    );
    expect(rejected.status).toBe(400);
    expect(rejected.body.code).toBe("INVALID_CONFIG");

    // 删除非激活的 A
    const removed = await call<ProviderProfilesView>(
      running,
      "DELETE",
      `/api/settings/provider/profiles/${profileAId}`,
    );
    expect(removed.status).toBe(200);
    expect(removed.body.profiles).toHaveLength(1);
    expect(removed.body.profiles[0]?.config.id).toBe(profileBId);
    expect(removed.body.activeId).toBe(profileBId);

    // 不存在的配置返回 404
    const missing = await call<{ code: string }>(
      running,
      "DELETE",
      "/api/settings/provider/profiles/not-exists",
    );
    expect(missing.status).toBe(404);
  });

  it("重名另存返回 400", async () => {
    await call<ProviderSettingsView>(running, "PUT", "/api/settings/provider", {
      provider: providerInput(),
      apiKey: KEY_A,
    });
    const duplicate = await call<{ code: string }>(
      running,
      "POST",
      "/api/settings/provider/profiles",
      { name: "服务商 A", provider: providerInput({ model: "model-a2" }) },
    );
    expect(duplicate.status).toBe(400);
    expect(duplicate.body.code).toBe("INVALID_CONFIG");
  });

  it("旧版单配置（无 profiles 数据）自动迁移，重启后 Key 可用", async () => {
    // 模拟旧版安装：只写 provider_config 行 + 旧凭据键 provider:default
    running.db
      .prepare(
        "INSERT INTO app_settings (key, value, updated_at) VALUES ('provider_config', ?, ?)",
      )
      .run(
        JSON.stringify({
          id: "default",
          name: "旧版配置",
          baseUrl: BASE_URL_A,
          model: "legacy-model",
          protocol: "openai-chat-completions",
        }),
        Date.now(),
      );
    const legacyCredentials = createCredentialStore(running.secretsDir);
    await legacyCredentials.set("provider:default", KEY_A);

    // 首次读取 profiles：懒迁移把单配置纳入列表（Key 有无标记直接查凭据库）
    const list = await call<ProviderProfilesView>(running, "GET", "/api/settings/provider/profiles");
    expect(list.status).toBe(200);
    expect(list.body.activeId).toBe("default");
    expect(list.body.profiles).toHaveLength(1);
    expect(list.body.profiles[0]?.config.model).toBe("legacy-model");
    expect(list.body.profiles[0]?.hasApiKey).toBe(true);
    expect(list.body.profiles[0]?.isActive).toBe(true);

    // 重启（生产路径 index.ts 在监听前 restore()）：迁移后的列表与旧凭据键生效
    await running.close();
    const db = new DatabaseSync(running.dbPath);
    try {
      const store = new ProviderSettingsStore(db, createCredentialStore(running.secretsDir));
      await store.restore();
      expect(store.getConfig().model).toBe("legacy-model");
      expect(store.getApiKey()).toBe(KEY_A);
      const view = store.getView();
      expect(view.hasApiKey).toBe(true);
      expect(view.apiKeyMasked).toBe(maskApiKey(KEY_A));
    } finally {
      db.close();
    }
  });

  it("重启后恢复激活配置及其 Key", async () => {
    await call<ProviderSettingsView>(running, "PUT", "/api/settings/provider", {
      provider: providerInput(),
      apiKey: KEY_A,
    });
    await call<ProviderSettingsView>(running, "POST", "/api/settings/provider/profiles", {
      name: "服务商 B",
      provider: providerInput({ baseUrl: BASE_URL_B, model: "model-b" }),
    });
    // 上面另存后激活的是 B；给它配上独立 Key
    const profileBId = (
      await call<ProviderProfilesView>(running, "GET", "/api/settings/provider/profiles")
    ).body.profiles.find((profile) => profile.config.name === "服务商 B")?.config.id;
    expect(profileBId).toBeTruthy();
    await call<ProviderSettingsView>(running, "PUT", "/api/settings/provider", {
      provider: providerInput({
        id: profileBId,
        name: "服务商 B",
        baseUrl: BASE_URL_B,
        model: "model-b",
      }),
      apiKey: KEY_B,
    });

    // 关闭应用模拟重启
    await running.close();

    const db = new DatabaseSync(running.dbPath);
    try {
      const store = new ProviderSettingsStore(db, createCredentialStore(running.secretsDir));
      await store.restore();
      expect(store.getConfig().model).toBe("model-b");
      expect(store.getApiKey()).toBe(KEY_B);

      // 切回 default 后密钥缓存随切换更新
      await store.switchProfile("default");
      expect(store.getConfig().model).toBe("model-a");
      expect(store.getApiKey()).toBe(KEY_A);
    } finally {
      db.close();
    }
  });
});
