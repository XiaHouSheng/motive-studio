import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { WorkspaceData } from "@motive/shared";
import { afterEach, describe, expect, it } from "vitest";
import { startDesktopServer, type DesktopServer } from "./desktop.js";

/** 空闲超时注入为短时间，验证生命周期而不实际等待 30 分钟 */
const IDLE_MS = 400;
const FAST_IDLE_MS = 250;

interface ApiResult {
  status: number;
  body: unknown;
  text: string;
}

const tracked: { server: DesktopServer; dir: string }[] = [];

function makeDir(): string {
  return mkdtempSync(path.join(tmpdir(), "motive-desktop-test-"));
}

async function startDesktop(opts: {
  port?: number;
  lanIdleTimeoutMs?: number;
} = {}): Promise<DesktopServer> {
  const dir = makeDir();
  const server = await startDesktopServer({
    dataDir: dir,
    port: opts.port,
    lanIdleTimeoutMs: opts.lanIdleTimeoutMs,
  });
  tracked.push({ server, dir });
  return server;
}

async function call(
  server: DesktopServer,
  method: string,
  route: string,
  body?: unknown,
  basePort?: number,
  headers?: Record<string, string>,
): Promise<ApiResult> {
  const response = await fetch(`http://127.0.0.1:${basePort ?? server.port}${route}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed, text };
}

interface LinkResponse {
  token: string;
  urls: string[];
  preferred: string | null;
}

async function link(server: DesktopServer): Promise<LinkResponse> {
  const result = await call(server, "POST", "/api/mobile/link", { key: randomUUID() });
  expect(result.status).toBe(200);
  return result.body as LinkResponse;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(async () => {
  while (tracked.length > 0) {
    const item = tracked.pop();
    if (!item) break;
    await item.server.close().catch(() => undefined);
    rmSync(item.dir, { recursive: true, force: true });
  }
  delete process.env.MOTIVE_PORT;
});

describe("桌面版主服务", () => {
  it("主 API 仅监听 127.0.0.1，不提供环境变量覆盖", async () => {
    process.env.MOTIVE_HOST = "0.0.0.0"; // 桌面版必须忽略该变量
    try {
      const server = await startDesktop();
      expect(server.host).toBe("127.0.0.1");
      expect(server.getLocalAddress()).toBe("127.0.0.1");
    } finally {
      delete process.env.MOTIVE_HOST;
    }
  });

  it("局域网监听初始未启动", async () => {
    const server = await startDesktop();
    expect(server.getLanState()).toBe("stopped");
    expect(server.getLanPort()).toBeNull();
  });

  it("调用 /api/mobile/link 后懒启动监听，且与主 API 端口不同", async () => {
    const server = await startDesktop();
    const result = await link(server);
    expect(server.getLanState()).toBe("running");
    const lanPort = server.getLanPort();
    expect(lanPort).not.toBeNull();
    expect(lanPort).not.toBe(server.port);
    expect(result.urls.length).toBeGreaterThan(0);
    for (const url of result.urls) {
      expect(url.endsWith(`/m?t=${result.token}`)).toBe(true);
      expect(url.includes(`:${lanPort}/m`)).toBe(true);
    }
    expect(result.preferred).toBe(result.urls[0]);
  });

  it("局域网监听无法访问完整 API", async () => {
    const server = await startDesktop();
    await link(server);
    const lanPort = server.getLanPort() as number;
    const bootstrap = await call(server, "GET", "/api/bootstrap", undefined, lanPort);
    expect(bootstrap.status).toBe(404);
    expect((bootstrap.body as { code?: string }).code).toBe("NOT_FOUND");
    const createGroup = await call(
      server,
      "POST",
      "/api/question-groups",
      { title: "越权" },
      lanPort,
    );
    expect(createGroup.status).toBe(404);
  });

  it("局域网监听无法访问 AI 设置、密钥管理和数据库管理接口", async () => {
    const server = await startDesktop();
    await link(server);
    const lanPort = server.getLanPort() as number;
    const settings = await call(server, "GET", "/api/settings/provider", undefined, lanPort);
    expect(settings.status).toBe(404);
    const providerTest = await call(
      server,
      "POST",
      "/api/settings/provider/test",
      {},
      lanPort,
    );
    expect(providerTest.status).toBe(404);
    const backup = await call(server, "GET", "/api/backup", undefined, lanPort);
    expect(backup.status).toBe(404);
    const backupImport = await call(server, "POST", "/api/backup/import", {}, lanPort);
    expect(backupImport.status).toBe(404);
  });

  it("无 Token 请求被拒绝", async () => {
    const server = await startDesktop();
    await link(server);
    const lanPort = server.getLanPort() as number;
    const denied = await call(server, "GET", "/api/mobile/groups", undefined, lanPort);
    expect(denied.status).toBe(403);
  });

  it("有效 Token 可以完成移动导入", async () => {
    const server = await startDesktop();
    const { token } = await link(server);
    const lanPort = server.getLanPort() as number;

    const page = await fetch(`http://127.0.0.1:${lanPort}/m?t=${token}`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");

    const groups = await call(
      server,
      "GET",
      "/api/mobile/groups",
      undefined,
      lanPort,
      { "x-mobile-token": token },
    );
    expect(groups.status).toBe(200);

    const commit = await call(
      server,
      "POST",
      "/api/mobile/commit",
      { target: { type: "new", title: "手机题组" }, questions: ["1+1=？"] },
      lanPort,
      { "x-mobile-token": token },
    );
    expect(commit.status).toBe(200);

    const workspace = await call(server, "GET", "/api/bootstrap");
    expect(
      (workspace.body as WorkspaceData).groups.some((group) => group.title === "手机题组"),
    ).toBe(true);
  });

  it("无效 Token 不刷新空闲计时", async () => {
    const server = await startDesktop({ lanIdleTimeoutMs: IDLE_MS });
    await link(server);
    expect(server.getLanState()).toBe("running");
    const lanPort = server.getLanPort() as number;

    // 空闲窗口内多次无效请求，均不应刷新计时
    for (let i = 0; i < 3; i += 1) {
      const denied = await call(server, "GET", "/api/mobile/groups", undefined, lanPort, {
        "x-mobile-token": "invalid-token",
      });
      expect(denied.status).toBe(403);
      await sleep(50);
    }

    await sleep(IDLE_MS + 200);
    expect(server.getLanState()).toBe("stopped");
  });

  it("无关路由请求不刷新空闲计时", async () => {
    const server = await startDesktop({ lanIdleTimeoutMs: IDLE_MS });
    await link(server);
    const lanPort = server.getLanPort() as number;

    for (let i = 0; i < 3; i += 1) {
      const miss = await call(server, "GET", "/no-such-route", undefined, lanPort);
      expect(miss.status).toBe(404);
      await sleep(50);
    }

    await sleep(IDLE_MS + 200);
    expect(server.getLanState()).toBe("stopped");
  });

  it("正在进行的上传不会被空闲清理中断", async () => {
    const server = await startDesktop({ lanIdleTimeoutMs: FAST_IDLE_MS });
    await link(server);
    const lanPort = server.getLanPort() as number;

    // 用未发送完整的请求体模拟慢速上传：请求持续在途
    const socket = net.connect(lanPort, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    });
    socket.write(
      "POST /api/mobile/commit HTTP/1.1\r\n" +
        "Host: 127.0.0.1\r\n" +
        "Content-Type: application/json\r\n" +
        "x-mobile-token: missing\r\n" +
        "Content-Length: 400\r\n" +
        "\r\n" +
        '{"partial":',
    );

    // 空闲超时多次到期，但请求仍在途，监听必须保持
    await sleep(FAST_IDLE_MS * 2 + 100);
    expect(server.getLanState()).toBe("running");

    socket.destroy();
    await sleep(FAST_IDLE_MS + 250);
    expect(server.getLanState()).toBe("stopped");
  });

  it("空闲超时后监听自动关闭，且可再次启动", async () => {
    const server = await startDesktop({ lanIdleTimeoutMs: FAST_IDLE_MS });
    await link(server);
    expect(server.getLanState()).toBe("running");

    await sleep(FAST_IDLE_MS + 200);
    expect(server.getLanState()).toBe("stopped");
    expect(server.getLanPort()).toBeNull();

    // 空闲关闭后允许重新启动（新的配对）
    await link(server);
    expect(server.getLanState()).toBe("running");
  });

  it("监听关闭后旧二维码不能继续使用", async () => {
    const server = await startDesktop({ lanIdleTimeoutMs: FAST_IDLE_MS });
    const { token } = await link(server);
    const lanPort = server.getLanPort() as number;

    await sleep(FAST_IDLE_MS + 200);
    expect(server.getLanState()).toBe("stopped");

    // 监听已关闭：旧二维码的端口直接拒绝连接
    const refused = await new Promise<boolean>((resolve) => {
      const socket = net.connect(lanPort, "127.0.0.1");
      socket.once("connect", () => {
        socket.destroy();
        resolve(false);
      });
      socket.once("error", (error: NodeJS.ErrnoException) => {
        resolve(error.code === "ECONNREFUSED");
      });
    });
    expect(refused).toBe(true);

    // 监听重新启动后（可能复用同一端口），旧 Token 也必须失效（会话已清空）
    const relinked = await link(server);
    const newLanPort = server.getLanPort() as number;
    const oldPage = await fetch(`http://127.0.0.1:${newLanPort}/m?t=${token}`);
    expect(oldPage.status).toBe(403);
    const oldApi = await call(server, "GET", "/api/mobile/groups", undefined, newLanPort, {
      "x-mobile-token": token,
    });
    expect(oldApi.status).toBe(403);
    const newPage = await fetch(`http://127.0.0.1:${newLanPort}/m?t=${relinked.token}`);
    expect(newPage.status).toBe(200);
  });

  it("主服务关闭时监听同步关闭", async () => {
    const server = await startDesktop();
    await link(server);
    expect(server.getLanState()).toBe("running");

    await server.close();
    expect(server.getLanState()).toBe("closed");
    expect(server.getLanPort()).toBeNull();
  });

  it("重复调用 close() 不产生异常", async () => {
    const server = await startDesktop();
    await link(server);
    await expect(Promise.all([server.close(), server.close()])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    await expect(server.close()).resolves.toBeUndefined();
  });

  it("固定端口被占用时仅 EADDRINUSE 回退随机端口，ready 端口为实际端口", async () => {
    const blocker = createServer((_request, response) => response.end());
    await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
    const blockerPort = (blocker.address() as AddressInfo).port;

    try {
      // options.port 固定端口被占用 → 回退随机端口并正常提供服务
      const fallback = await startDesktop({ port: blockerPort });
      expect(fallback.port).not.toBe(blockerPort);
      expect(fallback.port).toBeGreaterThan(0);
      const health = await call(fallback, "GET", "/api/health");
      expect(health.status).toBe(200);
      await fallback.close();

      // env MOTIVE_PORT 固定端口被占用 → 同样回退
      process.env.MOTIVE_PORT = String(blockerPort);
      const envFallback = await startDesktop();
      expect(envFallback.port).not.toBe(blockerPort);
      expect(envFallback.port).toBeGreaterThan(0);
      await envFallback.close();

      // MOTIVE_PORT 无效仍是启动失败
      process.env.MOTIVE_PORT = "not-a-port";
      await expect(startDesktop()).rejects.toThrow(/MOTIVE_PORT 无效/);
    } finally {
      delete process.env.MOTIVE_PORT;
      blocker.close();
    }
  });

  it("健康检查返回应用身份，供桌面壳校验 service=motive-studio", async () => {
    const server = await startDesktop();
    const health = await call(server, "GET", "/api/health");
    expect(health.status).toBe(200);
    expect((health.body as { service?: string }).service).toBe("motive-studio");
  });

  it("非 EADDRINUSE 的监听错误原样抛出，不回退随机端口", async () => {
    // 65536 超出合法端口范围，触发 ERR_SOCKET_BAD_PORT（非 EADDRINUSE）
    await expect(startDesktop({ port: 65_536 })).rejects.toThrow();
    await expect(startDesktop({ port: 65_536 })).rejects.not.toThrow(/已被占用/);
  });

  it("数据库在服务端关闭后仍然保持数据完整", async () => {
    const dir = makeDir();
    const first = await startDesktopServer({ dataDir: dir });
    const created = await call(first, "POST", "/api/question-groups", { title: "桌面数据" });
    expect(created.status).toBe(201);
    await first.close();

    const second = await startDesktopServer({ dataDir: dir });
    tracked.push({ server: second, dir });
    const workspace = await call(second, "GET", "/api/bootstrap");
    expect(
      (workspace.body as WorkspaceData).groups.some((group) => group.title === "桌面数据"),
    ).toBe(true);
    await second.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
