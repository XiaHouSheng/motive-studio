import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";

interface RunningApp {
  baseUrl: string;
  close: () => Promise<void>;
}

/** 模拟经反代/隧道而来的远程请求：Caddy 必带 X-Forwarded-For */
const REMOTE_HEADERS = { "X-Forwarded-For": "203.0.113.7" };

async function start(dbPath: string): Promise<RunningApp> {
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

/** 启用远程接入并生成密钥（回环调用），返回密钥 */
async function enableGate(running: RunningApp): Promise<string> {
  const put = await fetch(`${running.baseUrl}/api/settings/remote-access`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      enabled: true,
      publicOrigin: "https://motive.example.duckdns.org:39222",
    }),
  });
  expect(put.status).toBe(200);

  const rotate = await fetch(`${running.baseUrl}/api/settings/remote-access/rotate`, {
    method: "POST",
  });
  expect(rotate.status).toBe(200);
  const body = (await rotate.json()) as { token: string };
  expect(body.token).toBeTruthy();
  return body.token;
}

interface GateResponse<T = unknown> {
  status: number;
  body: T;
  setCookie: string;
  location: string;
}

async function call(
  running: RunningApp,
  method: string,
  route: string,
  options: {
    headers?: Record<string, string>;
    body?: unknown;
  } = {},
): Promise<GateResponse> {
  const response = await fetch(`${running.baseUrl}${route}`, {
    method,
    headers: {
      ...REMOTE_HEADERS,
      ...options.headers,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: "manual",
  });
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text.startsWith("{") || text.startsWith("[") ? JSON.parse(text) : text;
  } catch {
    parsed = text;
  }
  return {
    status: response.status,
    body: parsed as never,
    setCookie: response.headers.get("set-cookie") ?? "",
    location: response.headers.get("location") ?? "",
  };
}

function cookieFrom(setCookie: string): string {
  const pair = setCookie.split(";")[0];
  expect(pair).toContain("motive_token=");
  return pair;
}

describe("远程接入门卫", () => {
  let dir: string;
  let dbPath: string;
  let running: RunningApp;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "motive-gate-test-"));
    dbPath = path.join(dir, "motive.db");
    running = await start(dbPath);
  });

  afterEach(async () => {
    await running.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("未启用门卫时远程请求直接放行", async () => {
    const result = await call(running, "GET", "/api/bootstrap");
    expect(result.status).toBe(200);
  });

  it("启用后：远程无密钥 403，回环豁免，豁免路径不受影响", async () => {
    await enableGate(running);

    const denied = await call(running, "GET", "/api/bootstrap");
    expect(denied.status).toBe(403);
    expect((denied.body as { code: string }).code).toBe("UNAUTHORIZED");

    // 回环（无 XFF）豁免：桌面端日常使用不受影响
    const loopback = await fetch(`${running.baseUrl}/api/bootstrap`);
    expect(loopback.status).toBe(200);

    // 健康检查豁免
    const health = await call(running, "GET", "/api/health");
    expect(health.status).toBe(200);

    // 手机拍照链路自带配对凭证，豁免
    const link = await fetch(`${running.baseUrl}/api/mobile/link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: randomUUID() }),
    });
    expect(link.status).toBe(200);
    const { token } = (await link.json()) as { token: string };

    const mobilePage = await call(running, "GET", `/m?t=${token}`);
    expect(mobilePage.status).toBe(200);
    const groups = await call(running, "GET", "/api/mobile/groups", {
      headers: { "X-Mobile-Token": token },
    });
    expect(groups.status).toBe(200);
  });

  it("verify 绑定：正确密钥种 Cookie，错误密钥 403", async () => {
    const token = await enableGate(running);

    const wrong = await call(running, "POST", "/api/access/verify", {
      body: { token: "wrong-token" },
    });
    expect(wrong.status).toBe(403);
    expect(wrong.setCookie).not.toContain("motive_token=");

    const right = await call(running, "POST", "/api/access/verify", {
      body: { token },
    });
    expect(right.status).toBe(200);
    expect(right.setCookie).toContain("motive_token=");
    expect(right.setCookie).toContain("HttpOnly");
    expect(right.setCookie).toContain("SameSite=Lax");
  });

  it("Cookie 与 ?t=（API）均可通过；?t= 文档请求 303 去参并种 Cookie", async () => {
    const token = await enableGate(running);

    const bound = await call(running, "POST", "/api/access/verify", { body: { token } });
    const cookie = cookieFrom(bound.setCookie);

    const viaCookie = await call(running, "GET", "/api/bootstrap", {
      headers: { Cookie: cookie },
    });
    expect(viaCookie.status).toBe(200);

    // API 场景 ?t= 直通（不重定向）
    const viaQuery = await call(running, "GET", `/api/bootstrap?t=${token}`);
    expect(viaQuery.status).toBe(200);

    // 文档场景 ?t= → 303 重定向去掉查询参数，并种 Cookie
    const doc = await call(running, "GET", `/?t=${token}`, {
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    expect(doc.status).toBe(303);
    expect(doc.location).toBe("/");
    expect(doc.setCookie).toContain("motive_token=");

    // 未持密钥的文档请求：服务端兜底渲染绑定页
    const gatePage = await call(running, "GET", "/", {
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    expect(gatePage.status).toBe(403);
    expect(gatePage.body).toContain("绑定访问密钥");
  });

  it("验证失败限速：窗口内 15 次失败后返回 429", async () => {
    await enableGate(running);

    for (let attempt = 0; attempt < 15; attempt += 1) {
      const result = await call(running, "POST", "/api/access/verify", {
        body: { token: `bad-${attempt}` },
      });
      expect(result.status).toBe(403);
    }
    const limited = await call(running, "POST", "/api/access/verify", {
      body: { token: "anything" },
    });
    expect(limited.status).toBe(429);
    expect((limited.body as { code: string }).code).toBe("RATE_LIMITED");
  });

  it("轮换密钥后旧 Cookie 立即失效，新密钥可用", async () => {
    const oldToken = await enableGate(running);
    const bound = await call(running, "POST", "/api/access/verify", { body: { token: oldToken } });
    const oldCookie = cookieFrom(bound.setCookie);
    expect((await call(running, "GET", "/api/bootstrap", { headers: { Cookie: oldCookie } })).status).toBe(200);

    const rotate = await fetch(`${running.baseUrl}/api/settings/remote-access/rotate`, {
      method: "POST",
    });
    expect(rotate.status).toBe(200);
    const { token: newToken } = (await rotate.json()) as { token: string };
    expect(newToken).not.toBe(oldToken);

    const stale = await call(running, "GET", "/api/bootstrap", { headers: { Cookie: oldCookie } });
    expect(stale.status).toBe(403);

    const rebound = await call(running, "POST", "/api/access/verify", { body: { token: newToken } });
    expect(rebound.status).toBe(200);
  });

  it("吊销密钥后门卫关闭；完整密钥仅回环返回", async () => {
    await enableGate(running);

    // 远程（模拟）查看状态：不含密钥本体
    const remoteView = await call(running, "GET", "/api/settings/remote-access");
    expect(remoteView.status).toBe(403); // 未绑定远程直接被门卫拦截

    const bound = await fetch(`${running.baseUrl}/api/settings/remote-access`);
    expect(bound.status).toBe(200);
    const loopbackView = (await bound.json()) as { token?: string; accessUrl?: string | null };
    expect(loopbackView.token).toBeTruthy();
    expect(loopbackView.accessUrl).toContain("?t=");

    // 远程已绑定设备可见状态，但不含密钥
    const verify = await call(running, "POST", "/api/access/verify", {
      body: { token: loopbackView.token },
    });
    const cookie = cookieFrom(verify.setCookie);
    const remoteBoundView = await call(running, "GET", "/api/settings/remote-access", {
      headers: { Cookie: cookie },
    });
    expect(remoteBoundView.status).toBe(200);
    expect((remoteBoundView.body as { token?: string }).token).toBeUndefined();

    // 吊销后门卫关闭，远程请求恢复放行
    const revoke = await fetch(`${running.baseUrl}/api/settings/remote-access/token`, {
      method: "DELETE",
    });
    expect(revoke.status).toBe(200);
    const afterRevoke = await call(running, "GET", "/api/bootstrap");
    expect(afterRevoke.status).toBe(200);
  });

  it("密钥轮换与吊销拒绝远程执行", async () => {
    await enableGate(running);
    const token = await enableGate(running);
    const bound = await call(running, "POST", "/api/access/verify", { body: { token } });
    const cookie = cookieFrom(bound.setCookie);

    const remoteRotate = await call(running, "POST", "/api/settings/remote-access/rotate", {
      headers: { Cookie: cookie },
    });
    expect(remoteRotate.status).toBe(403);

    const remoteRevoke = await call(running, "DELETE", "/api/settings/remote-access/token", {
      headers: { Cookie: cookie },
    });
    expect(remoteRevoke.status).toBe(403);
  });
});
