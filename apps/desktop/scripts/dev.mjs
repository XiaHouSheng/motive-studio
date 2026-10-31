import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * 桌面开发编排：
 * 1. 以真实 HTTP 健康检查探测 web(5173) 与 server(3001)；
 * 2. 均未运行 → 拉起根目录 npm run dev；均已运行 → 直接复用；
 *    一有一无 → 明确报错退出（避免半启动状态与误杀外部进程）；
 * 3. 就绪后以 MOTIVE_DESKTOP_DEV=1 启动 Electron；
 * 4. Electron 退出或 Ctrl+C → 终止本次启动的开发子进程（Windows
 *    用 taskkill /T /F 整树终止），不触碰本次未启动的进程。
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, "..");
const repoRoot = path.resolve(desktopRoot, "..", "..");

const isWindows = process.platform === "win32";
const npm = isWindows ? "npm.cmd" : "npm";

const WEB_URL = "http://127.0.0.1:5173";
const API_HEALTH_URL = "http://127.0.0.1:3001/api/health";
const READY_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 400;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isUp(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(800) });
    return response.ok;
  } catch {
    return false;
  }
}

/** Windows 下按进程树强制终止，避免 npm 包装层留下孤儿子进程。 */
function killTree(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  if (isWindows) {
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      // 进程可能已退出
    }
  } else {
    try {
      child.kill("SIGTERM");
    } catch {
      // 忽略
    }
  }
}

function pipeWithPrefix(stream, prefix) {
  stream.setEncoding("utf8");
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) process.stdout.write(`${prefix} ${line}\n`);
  });
  stream.on("end", () => {
    if (buffer) process.stdout.write(`${prefix} ${buffer}\n`);
  });
}

const webUp = await isUp(WEB_URL);
const apiUp = await isUp(API_HEALTH_URL);

let electronExitHandled = false;
let devChild = null;
if (webUp && apiUp) {
  console.log("[dev] 复用已运行的开发服务（web :5173 · server :3001）");
} else if (!webUp && !apiUp) {
  console.log("[dev] 启动根目录开发服务（web + server）…");
  devChild = spawn(npm, ["run", "dev"], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    shell: isWindows,
    env: process.env,
  });
  pipeWithPrefix(devChild.stdout, "[dev]  ");
  pipeWithPrefix(devChild.stderr, "[dev]  ");
  devChild.on("exit", (code) => {
    if (electronExitHandled) return;
    console.error(`[dev] 开发服务已退出（code ${code ?? 0}），终止桌面开发模式`);
    process.exit(1);
  });
} else {
  console.error(
    `[dev] 检测到半启动状态：web ${webUp ? "运行中" : "未运行"} · server ${apiUp ? "运行中" : "未运行"}。`,
  );
  console.error("[dev] 请先同时启动或同时停止开发服务（npm run dev）后重试。");
  process.exit(1);
}

const deadline = Date.now() + READY_TIMEOUT_MS;
while (!(await isUp(WEB_URL)) || !(await isUp(API_HEALTH_URL))) {
  if (Date.now() > deadline) {
    console.error("[dev] 开发服务就绪超时（60s），终止。");
    if (devChild) killTree(devChild);
    process.exit(1);
  }
  await sleep(POLL_INTERVAL_MS);
}
console.log("[dev] 开发服务就绪");

const electronBin = path.join(repoRoot, "node_modules", ".bin", isWindows ? "electron.cmd" : "electron");
const electron = spawn(electronBin, ["."], {
  cwd: desktopRoot,
  stdio: "inherit",
  shell: isWindows,
  env: { ...process.env, MOTIVE_DESKTOP_DEV: "1" },
});

electron.on("error", (error) => {
  console.error(`[electron] 启动失败：${error.message}`);
  if (devChild) killTree(devChild);
  process.exit(1);
});

electron.on("exit", (code) => {
  electronExitHandled = true;
  console.log(`[electron] 已退出（code ${code ?? 0}）`);
  if (devChild) killTree(devChild);
  process.exit(code ?? 0);
});

const shutdown = () => {
  killTree(electron);
  if (devChild) killTree(devChild);
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
