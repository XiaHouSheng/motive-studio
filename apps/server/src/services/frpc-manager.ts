import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/** frps 控制通道端口（端口规范：39217 基准递增） */
export const FRPS_SERVER_PORT = 39220;
/** frps 服务转发端口（与 frps.toml 的 allowPorts 一致） */
export const FRPS_REMOTE_PORT = 39221;

/** frpc 可执行文件名（随平台变化） */
export const FRPC_BINARY_NAME = process.platform === "win32" ? "frpc.exe" : "frpc";
/** 日志环容量：面板诊断展示最近若干行 */
const LOG_RING_SIZE = 30;

/** 端口规范内固定值，用户无需感知 */
export interface FrpcStartInput {
  /** frps 服务器地址（IP 或域名，不含端口） */
  serverAddr: string;
  /** frps auth.token */
  authToken: string;
}

export type FrpcStatus = "stopped" | "running" | "error";

export interface FrpcState {
  /** frpc 可执行文件是否可用（不可用时无法广播） */
  available: boolean;
  status: FrpcStatus;
  /** 非运行状态的补充说明（二进制缺失原因 / 退出码与最近日志） */
  detail?: string;
}

/** 生成 frpc 运行配置（内容与端口规范固定，仅地址/令牌/本机端口可变） */
export function buildFrpcConfig(input: {
  serverAddr: string;
  authToken: string;
  localPort: number;
}): string {
  return [
    `serverAddr = "${input.serverAddr}"`,
    `serverPort = ${FRPS_SERVER_PORT}`,
    `auth.token = "${input.authToken}"`,
    `transport.tls.enable = true`,
    `loginFailExit = false`,
    `transport.heartbeatInterval = 30`,
    `transport.heartbeatTimeout = 90`,
    ``,
    `[[proxies]]`,
    `name = "motive-studio"`,
    `type = "tcp"`,
    `localIP = "127.0.0.1"`,
    `localPort = ${input.localPort}`,
    `remotePort = ${FRPS_REMOTE_PORT}`,
    ``,
  ].join("\n");
}

/** 按序解析 frpc 可执行文件：显式环境变量 → 随应用打包 → 用户数据目录 */
export function resolveFrpcBinary(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      // 无法访问的候选路径直接跳过
    }
  }
  return null;
}

/**
 * 桌面端内嵌 frpc 管理器：应用代管 frpc 进程，用户只需在设置中
 * 填写服务器地址与 frps 令牌并通过开关确认是否广播。
 *
 * - 启动前把运行配置写入 <dataDir>/frpc.toml（含 frps 令牌明文，仅本机用户可读，
 *   与凭据存储的保护级别一致；frpc 运行时本身需要读取）。
 * - frpc 内部自带断线重连（loginFailExit=false），本管理器不额外做重启循环；
 *   进程意外退出时标记 error 并保留最近日志供面板诊断。
 */
export class FrpcManager {
  private readonly candidatePaths: string[];
  private readonly configPath: string;
  private child: ChildProcess | null = null;
  private status: FrpcStatus = "stopped";
  private detail: string | null = null;
  private readonly logs: string[] = [];
  private localPort = 0;

  constructor(options: { candidatePaths: string[]; dataDir: string }) {
    this.candidatePaths = options.candidatePaths;
    this.configPath = path.join(options.dataDir, "frpc.toml");
    mkdirSync(options.dataDir, { recursive: true });
  }

  /** 主服务实际监听端口（EADDRINUSE 回退随机端口后由 desktop.ts 回填） */
  setLocalPort(port: number): void {
    if (Number.isInteger(port) && port > 0) this.localPort = port;
  }

  getStatus(): FrpcState {
    if (!this.getBinary()) {
      return { available: false, status: this.status, detail: "未找到 frpc 可执行文件" };
    }
    return { available: true, status: this.status, detail: this.detail ?? undefined };
  }

  getBinary(): string | null {
    return resolveFrpcBinary(this.candidatePaths);
  }

  /**
   * 启动 frpc。前置条件（二进制存在、参数完整）由调用方（settings 路由）校验；
   * 同步 spawn 失败或进程快速退出不会抛出，而是反映在 getStatus() 中。
   */
  start(input: FrpcStartInput): void {
    const binary = this.getBinary();
    if (!binary) {
      this.status = "error";
      this.detail = "未找到 frpc 可执行文件";
      return;
    }
    this.stop();
    this.status = "running";
    this.detail = null;
    this.logs.length = 0;

    try {
      // 本机端口未知时使用端口规范的默认值（正常时序：desktop.ts 监听完成后才允许开启广播）
      const localPort = this.localPort || 39217;
      mkdirSync(path.dirname(this.configPath), { recursive: true });
      const config = buildFrpcConfig({
        serverAddr: input.serverAddr,
        authToken: input.authToken,
        localPort,
      });
      writeFileSync(this.configPath, config, "utf8");

      this.child = spawn(binary, ["-c", this.configPath], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      this.child = null;
      this.status = "error";
      this.detail = error instanceof Error ? error.message : String(error);
      return;
    }

    this.child.stdout?.setEncoding("utf8");
    this.child.stderr?.setEncoding("utf8");
    this.child.stdout?.on("data", (chunk: string) => this.pushLog(chunk));
    this.child.stderr?.on("data", (chunk: string) => this.pushLog(chunk));
    this.child.on("error", (error) => {
      this.status = "error";
      this.detail = error.message;
      this.child = null;
    });
    this.child.on("exit", (code) => {
      if (this.child === null) return; // 已被 stop() 主动结束
      this.child = null;
      this.status = code === 0 ? "stopped" : "error";
      this.detail =
        code === 0
          ? null
          : `frpc 退出（code=${code}）${this.logs.length > 0 ? `：${this.logs.slice(-3).join(" ")}` : ""}`;
    });
  }

  stop(): void {
    const child = this.child;
    this.child = null;
    // 无条件归位：即使进程已异常退出，用户主动停止后面板应显示未运行
    this.status = "stopped";
    this.detail = null;
    if (!child) return;
    try {
      // frpc 无需优雅收尾（纯转发），直接终止；exit 监听因 child 置空而忽略
      child.removeAllListeners();
      child.kill();
    } catch {
      // 进程已退出时忽略
    }
  }

  /** 随桌面服务关闭一并停止（closeOnce 调用） */
  shutdown(): void {
    this.stop();
  }

  private pushLog(chunk: string): void {
    for (const line of chunk.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      this.logs.push(trimmed);
      if (this.logs.length > LOG_RING_SIZE) this.logs.shift();
    }
  }
}
