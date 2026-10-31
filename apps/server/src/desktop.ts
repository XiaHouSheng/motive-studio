import type { Express, Request, Response } from "express";
import type { Server } from "node:http";
import express from "express";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { createApp } from "./app.js";
import { errorHandler } from "./middleware/error-handler.js";
import { createMobileRouter } from "./routes/mobile.js";
import type { ProviderSettingsStore } from "./services/ai/provider-settings-store.js";
import { AssetStore } from "./services/asset-store.js";
import { getLanAddresses } from "./services/lan.js";
import { MobileSessionStore } from "./services/mobile-session.js";
import type { MobileRuntime } from "./services/mobile-runtime.js";
import { HttpError } from "./http-error.js";

/**
 * 桌面版服务端入口（由 Electron Utility Process 通过 esbuild bundle 加载）。
 *
 * 与 Web 版（index.ts）的差异：
 * - 主 API 硬编码绑定 127.0.0.1，完整 API 不暴露到局域网；
 * - 数据目录注入（userData），数据库 / 上传 / 密钥 / 日志 / 备份集中管理；
 * - 端口默认 0 由操作系统分配（MOTIVE_PORT 可指定，被占用即启动失败，不静默回退）；
 * - 移动导入走独立的最小 Express 实例：仅挂载移动路由、绑定 0.0.0.0、
 *   独立动态端口、按需懒启动、空闲自动关闭。
 */

const MAIN_HOST = "127.0.0.1";
const LAN_HOST = "0.0.0.0";
const DEFAULT_LAN_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const CLOSE_GRACE_MS = 5_000;

export type LanListenerState = "stopped" | "starting" | "running" | "closing" | "closed";

export interface DesktopServerOptions {
  /** 主 API 端口；缺省 0（由操作系统分配）。MOTIVE_PORT 环境变量优先级更高。 */
  port?: number;
  /** 数据目录（桌面版为 userData）；数据库、上传、密钥、日志、备份均位于其下。 */
  dataDir: string;
  /** 局域网监听空闲超时；默认 30 分钟，测试可注入更短时间。 */
  lanIdleTimeoutMs?: number;
}

export interface LanAddress {
  host: string;
  port: number;
  /** 裸 origin 列表（不含路径与凭证），由路由层拼接 /m?t=<token>。 */
  urls: string[];
}

export interface DesktopServer {
  /** 主 API 实际监听端口。 */
  port: number;
  /** 主 API 监听地址（固定 127.0.0.1）。 */
  host: string;
  getLanState(): LanListenerState;
  getLanPort(): number | null;
  /** 主 API 绑定地址（来自 server.address()），用于测试验证。 */
  getLocalAddress(): string | null;
  /**
   * 优雅关闭：禁止新监听启动 → 关闭局域网监听 → 主服务停收连接 →
   * 等待在途请求（超时强制）→ 关闭数据库。幂等，多次调用返回同一 Promise。
   */
  close(): Promise<void>;
}

interface LanListenerOptions {
  idleTimeoutMs: number;
  /** 延迟取用移动会话实例（与主服务共享同一实例）。 */
  getSessions: () => MobileSessionStore;
  /** 创建仅挂载移动路由的独立 Express 实例。 */
  createLanApp: () => Express;
}

/** 在指定地址上启动监听，返回实际端口；失败时以 error 事件reject，不做端口预检。 */
function listenOn(server: Server, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      server.off("listening", onListening);
      server.off("error", onError);
    };
    const onListening = () => {
      cleanup();
      const address = server.address();
      resolve(address && typeof address !== "string" ? address.port : port);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    server.once("listening", onListening);
    server.once("error", onError);
    server.listen(port, host);
  });
}

function describeListenError(host: string, port: number, error: unknown): Error {
  if ((error as NodeJS.ErrnoException | null)?.code === "EADDRINUSE") {
    return new Error(
      `端口 ${port} 已被占用，无法监听 ${host}:${port}。请更换 MOTIVE_PORT 或释放该端口后重试。`,
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}

function resolvePort(optionsPort: number | undefined): number {
  const raw = process.env.MOTIVE_PORT?.trim();
  if (raw) {
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
      throw new Error(`MOTIVE_PORT 无效：「${raw}」必须是 0-65535 的整数`);
    }
    return parsed;
  }
  return optionsPort ?? 0;
}

/**
 * 局域网移动监听管理器。
 *
 * - 懒启动：首次 /api/mobile/link 才启动；独立 Express 实例 + 独立动态端口；
 * - 空闲超时自动关闭（默认 30 分钟，可注入）；只有配对成功、已授权页面访问
 *   与凭证校验通过的有效操作刷新活动时间；
 * - 在途请求（如上传）期间推迟空闲关闭；
 * - 关闭后清空移动会话，旧二维码立即失效；空闲关闭后可再次启动；
 * - 关闭过程中与主服务关闭流程开始后禁止再次启动；close() 幂等。
 */
export class LanListenerManager {
  #state: LanListenerState = "stopped";
  #server: Server | null = null;
  #port: number | null = null;
  #lastActivity = Date.now();
  #inFlight = 0;
  #idleTimer: NodeJS.Timeout | null = null;
  #starting: Promise<LanAddress> | null = null;
  #closing: Promise<void> | null = null;
  #forbidStarts = false;

  constructor(private readonly options: LanListenerOptions) {}

  get state(): LanListenerState {
    return this.#state;
  }

  get port(): number | null {
    return this.#port;
  }

  /** 主服务进入关闭流程后调用，彻底禁止再次启动。 */
  forbidStarts(): void {
    this.#forbidStarts = true;
  }

  ensure(): Promise<LanAddress> {
    if (this.#forbidStarts || this.#state === "closing" || this.#state === "closed") {
      return Promise.reject(
        new HttpError(503, "LAN_LISTENER_UNAVAILABLE", "局域网监听已关闭，无法生成手机访问链接"),
      );
    }
    if (this.#state === "running" && this.#port !== null) {
      this.touch();
      return Promise.resolve({ host: LAN_HOST, port: this.#port, urls: getLanAddresses(this.#port) });
    }
    if (this.#state === "starting" && this.#starting) {
      return this.#starting;
    }
    this.#state = "starting";
    this.#starting = this.#start();
    return this.#starting;
  }

  /** 刷新空闲计时；仅应在配对成功或移动凭证校验通过后调用。 */
  touch(): void {
    if (this.#state !== "running") return;
    this.#lastActivity = Date.now();
    this.#rearmIdleTimer();
  }

  /** 在途请求计数：空闲关闭会推迟到请求处理完毕（含上传）。 */
  trackEnter(): void {
    this.#inFlight += 1;
  }

  trackExit(): void {
    this.#inFlight = Math.max(0, this.#inFlight - 1);
  }

  /** 幂等关闭；重复调用返回同一 Promise。reason=idle 时回到 stopped（可再次启动）。 */
  close(reason: "idle" | "shutdown" = "shutdown"): Promise<void> {
    if (this.#closing) return this.#closing;
    if (this.#state === "stopped" || this.#state === "closed") {
      this.#state = reason === "idle" ? "stopped" : "closed";
      return Promise.resolve();
    }
    if (this.#idleTimer) {
      clearTimeout(this.#idleTimer);
      this.#idleTimer = null;
    }
    const starting = this.#starting;
    const targetState: LanListenerState = reason === "idle" ? "stopped" : "closed";
    const runClose = async (): Promise<void> => {
      if (starting) {
        try {
          await starting;
        } catch {
          // 启动失败的监听无需关闭
        }
      }
      const server = this.#server;
      if (server) {
        try {
          await new Promise<void>((resolve) => {
            server.close(() => resolve());
            server.closeIdleConnections?.();
            // 5s 后强制关闭剩余连接（含半关闭的 keep-alive socket），不可 unref
            setTimeout(() => server.closeAllConnections?.(), CLOSE_GRACE_MS);
          });
        } catch (error) {
          console.error("[desktop] 局域网监听关闭出错：", error);
        }
      }
      try {
        // 清空移动会话，确保旧二维码不能继续使用
        this.options.getSessions().clearAll();
      } catch (error) {
        console.error("[desktop] 清理移动会话出错：", error);
      }
      this.#server = null;
      this.#port = null;
      this.#starting = null;
      this.#state = targetState;
    };
    this.#state = "closing";
    this.#closing = runClose();
    void this.#closing.finally(() => {
      this.#closing = null;
    });
    return this.#closing;
  }

  #rearmIdleTimer(): void {
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    this.#idleTimer = setTimeout(() => this.#onIdleTimer(), this.options.idleTimeoutMs);
    this.#idleTimer.unref?.();
  }

  #onIdleTimer(): void {
    if (this.#state !== "running") return;
    if (Date.now() - this.#lastActivity < this.options.idleTimeoutMs) {
      // 计时器触发前有新的有效活动，重新计时
      this.#rearmIdleTimer();
      return;
    }
    if (this.#inFlight > 0) {
      // 上传等请求仍在处理，推迟到下一次检查
      this.#rearmIdleTimer();
      return;
    }
    void this.close("idle");
  }

  async #start(): Promise<LanAddress> {
    const lanApp = this.options.createLanApp();
    const server = lanApp.listen(0, LAN_HOST);
    try {
      const port = await listenOn(server, 0, LAN_HOST);
      this.#server = server;
      this.#port = port;
      this.#lastActivity = Date.now();
      this.#state = "running";
      this.#rearmIdleTimer();
      return { host: LAN_HOST, port, urls: getLanAddresses(port) };
    } catch (error) {
      try {
        server.close();
      } catch {
        // 未完成监听时忽略
      }
      this.#server = null;
      this.#port = null;
      this.#state = "stopped";
      throw new HttpError(
        503,
        "LAN_LISTENER_UNAVAILABLE",
        `局域网监听启动失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export async function startDesktopServer(options: DesktopServerOptions): Promise<DesktopServer> {
  const port = resolvePort(options.port);
  const dataDir = path.resolve(options.dataDir);
  const dbPath = path.join(dataDir, "motive.db");
  // 目录布局：motive.db / uploads / secrets / logs / backups
  mkdirSync(path.join(dataDir, "logs"), { recursive: true });
  mkdirSync(path.join(dataDir, "backups"), { recursive: true });

  const manager = new LanListenerManager({
    idleTimeoutMs: options.lanIdleTimeoutMs ?? DEFAULT_LAN_IDLE_TIMEOUT_MS,
    getSessions: () => app.locals.mobileSessions as MobileSessionStore,
    createLanApp: () => {
      // 独立 Express 实例：仅挂载移动路由，不承载完整 API / 设置 / 密钥 / 备份；
      // 服务实例与主服务共享（同一进程内复用 app.locals），不重复初始化
      const lanApp = express();
      lanApp.disable("x-powered-by");
      lanApp.use((_req: Request, res: Response, next) => {
        // 在途请求计数需先于 body 解析，覆盖慢速上传全程
        manager.trackEnter();
        res.on("close", () => manager.trackExit());
        next();
      });
      lanApp.use(express.json({ limit: "40mb" }));
      lanApp.use(
        createMobileRouter(
          app.locals.repository as Parameters<typeof createMobileRouter>[0],
          app.locals.settingsStore as ProviderSettingsStore,
          app.locals.mobileSessions as MobileSessionStore,
          app.locals.assetStore as AssetStore,
          runtime,
        ),
      );
      // 显式拒绝一切未匹配的路由与方法
      lanApp.use((_req: Request, res: Response) => {
        res.status(404).json({ code: "NOT_FOUND", message: "接口不存在" });
      });
      lanApp.use(errorHandler);
      return lanApp;
    },
  });

  const runtime: MobileRuntime = {
    ensureLanListener: () => manager.ensure(),
    touch: () => manager.touch(),
    getLanPort: () => manager.port,
  };

  const app = createApp({
    dbPath,
    uploadsDir: path.join(dataDir, "uploads"),
    secretsDir: path.join(dataDir, "secrets"),
    mobileRuntime: runtime,
  });

  let mainServer: Server;
  let actualPort: number;
  try {
    const settingsStore = app.locals.settingsStore as ProviderSettingsStore;
    await settingsStore.restore();
    mainServer = app.listen(port, MAIN_HOST);
    actualPort = await listenOn(mainServer, port, MAIN_HOST);
  } catch (error) {
    // 启动失败不留下半初始化状态（数据库已打开时先关闭）
    try {
      (app.locals.db as DatabaseSync).close();
    } catch {
      // 保留原始失败原因
    }
    throw (error as NodeJS.ErrnoException | null)?.code === "EADDRINUSE"
      ? describeListenError(MAIN_HOST, port, error)
      : error;
  }

  // 沿用 index.ts 的行为：大体积 base64 图片经慢速网络上传可能超过默认的
  // 整请求接收时限；headersTimeout / keepAliveTimeout 保持 Node 默认，
  // 均不影响 SSE 响应的持续时长
  mainServer.requestTimeout = 0;

  let closePromise: Promise<void> | null = null;
  const closeOnce = async (): Promise<void> => {
    const errors: unknown[] = [];
    // 1-2. 进入关闭流程：禁止新的局域网监听启动
    manager.forbidStarts();
    // 3. 关闭局域网监听（同步于主服务退出）
    await manager.close("shutdown").catch((error: unknown) => errors.push(error));
    // 4-6. 主服务停止接受新连接，等待在途请求结束，超时强制关闭剩余连接
    await new Promise<void>((resolve) => {
      mainServer.close(() => {
        console.log("[desktop] 主 HTTP Server 已关闭");
        resolve();
      });
      mainServer.closeIdleConnections?.();
      console.log("[desktop] 主服务停止接受新连接，等待在途请求结束");
      // 5s 后强制关闭剩余连接（含 Chromium 半关闭的 keep-alive socket），不可 unref
      setTimeout(() => {
        console.log("[desktop] 关闭超时，强制关闭剩余连接");
        mainServer.closeAllConnections?.();
      }, CLOSE_GRACE_MS);
    });
    // 7. 确认 HTTP Server 关闭后再关闭 SQLite（AI 流式任务均随请求生命周期中止）
    try {
      (app.locals.db as DatabaseSync).close();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length > 0) {
      console.error("[desktop] 桌面服务关闭过程中出现错误：", errors);
      throw errors.length === 1 ? errors[0] : new AggregateError(errors, "桌面服务关闭过程中出现多个错误");
    }
  };
  const close = (): Promise<void> => {
    if (!closePromise) closePromise = closeOnce();
    return closePromise;
  };

  return {
    port: actualPort,
    host: MAIN_HOST,
    getLanState: () => manager.state,
    getLanPort: () => manager.port,
    getLocalAddress: () => {
      const address = mainServer.address();
      return address && typeof address !== "string" ? address.address : null;
    },
    close,
  };
}
