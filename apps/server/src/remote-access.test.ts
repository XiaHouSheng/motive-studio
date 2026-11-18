import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { FrpcManager } from "./services/frpc-manager.js";

interface RunningApp {
  baseUrl: string;
  close: () => Promise<void>;
}

async function start(dbPath: string, frpc?: FrpcManager): Promise<RunningApp> {
  const app = createApp({
    dbPath,
    uploadsDir: path.join(path.dirname(dbPath), "uploads"),
    frpcManager: frpc,
  });
  const server: Server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("测试服务器未获得端口");
  let closed = false;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
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

async function putRemoteAccess(running: RunningApp, body: Record<string, unknown>) {
  const response = await fetch(`${running.baseUrl}/api/settings/remote-access`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function postFrpsToken(running: RunningApp, token: string, headers: Record<string, string> = {}) {
  const response = await fetch(`${running.baseUrl}/api/settings/remote-access/frps-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ token }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe("远程接入配置与内嵌 frpc 联动", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "motive-remote-test-"));
    dbPath = path.join(dir, "motive.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("serverAddr 归一化：粘贴带协议/端口的地址只保留主机名", async () => {
    const running = await start(dbPath);
    try {
      const result = await putRemoteAccess(running, { serverAddr: "https://motive.example.com:39220" });
      expect(result.status).toBe(200);
      expect(result.body.serverAddr).toBe("motive.example.com");

      const bare = await putRemoteAccess(running, { serverAddr: "203.0.113.9" });
      expect(bare.body.serverAddr).toBe("203.0.113.9");
    } finally {
      await running.close();
    }
  });

  it("frps 令牌：仅本机可设置，返回值只含是否已设置", async () => {
    const running = await start(dbPath);
    try {
      const denied = await postFrpsToken(running, "token", { "X-Forwarded-For": "203.0.113.7" });
      expect(denied.status).toBe(403);

      const ok = await postFrpsToken(running, "frps-secret");
      expect(ok.status).toBe(200);
      expect(ok.body.frpsTokenSet).toBe(true);
      expect(JSON.stringify(ok.body)).not.toContain("frps-secret");
    } finally {
      await running.close();
    }
  });

  it("web 方式（无 frpc 管理器）：启用仅作用于门卫，视图无 frpc 字段", async () => {
    const running = await start(dbPath);
    try {
      const result = await putRemoteAccess(running, { enabled: true });
      expect(result.status).toBe(200);
      expect(result.body.enabled).toBe(true);
      expect(result.body.frpc).toBeUndefined();
      // 门卫联动：首次启用自动生成访问密钥
      expect(result.body.hasToken).toBe(true);
    } finally {
      await running.close();
    }
  });

  it("桌面版（含 frpc 管理器）：缺令牌/缺地址拒绝开启广播", async () => {
    const fakeBinary = path.join(dir, "bin", "frpc.exe");
    mkdirSync(path.dirname(fakeBinary), { recursive: true });
    writeFileSync(fakeBinary, "");
    const frpc = new FrpcManager({ candidatePaths: [fakeBinary], dataDir: path.join(dir, "data") });
    const running = await start(dbPath, frpc);
    try {
      const noToken = await putRemoteAccess(running, { enabled: true, serverAddr: "203.0.113.9" });
      expect(noToken.status).toBe(400);
      expect(noToken.body.code).toBe("INVALID_CONFIG");

      await postFrpsToken(running, "frps-secret");
      const noAddr = await putRemoteAccess(running, { enabled: true });
      expect(noAddr.status).toBe(400);
      expect(noAddr.body.code).toBe("INVALID_CONFIG");

      const ok = await putRemoteAccess(running, { enabled: true, serverAddr: "203.0.113.9" });
      expect(ok.status).toBe(200);
      expect(ok.body.enabled).toBe(true);
      expect(ok.body.frpc).toBeTruthy();

      const stop = await putRemoteAccess(running, { enabled: false });
      expect(stop.status).toBe(200);
      expect((stop.body.frpc as { status: string }).status).toBe("stopped");
    } finally {
      frpc.shutdown();
      await running.close();
    }
  });
});
