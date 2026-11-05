import { app, BrowserWindow, dialog, ipcMain, shell, utilityProcess } from "electron";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Motive Studio 桌面壳（Electron 主进程）。
 *
 * 职责边界：只负责桌面运行环境与生命周期管理，不承载任何业务逻辑。
 * Express 服务运行在 Utility Process（见 server-entry.mjs），
 * 渲染进程通过同源 HTTP 访问服务端，不暴露任何 Node API。
 *
 * 启动顺序：单实例锁 → userData 初始化 → 启动 Utility Process →
 * 收到就绪消息（实际端口）→ 健康检查 → 创建窗口 → 加载界面。
 * 服务启动失败时不创建空白窗口，给出明确错误并正确清理。
 */

const here = path.dirname(fileURLToPath(import.meta.url));
// preload 必须为 CJS（sandbox 模式不支持 ESM preload），路径基于本文件所在目录解析
const preloadPath = path.join(here, "preload.cjs");
const isDev = process.env.MOTIVE_DESKTOP_DEV === "1";
const DEV_URL = "http://localhost:5173";

/**
 * 服务端默认固定端口：稳定的 origin 让 localStorage（主题/语言/面板宽度）
 * 在重启后保持可用。端口被占用时服务端会回退到随机端口（仅 EADDRINUSE），
 * 就绪消息会携带实际端口，界面偏好由 /api/settings/ui 兜底恢复。
 */
const DEFAULT_SERVER_PORT = 39_217;

const SERVER_START_TIMEOUT_MS = 15_000;
const HEALTH_CHECK_TIMEOUT_MS = 10_000;
const HEALTH_CHECK_INTERVAL_MS = 200;
const SERVER_SHUTDOWN_TIMEOUT_MS = 8_000;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // 已有实例在运行：立即退出，由 first-instance 侧聚焦已有窗口
  app.quit();
} else {
  bootstrap();
}

function bootstrap() {
  // 统一应用名与 userData：app.setName 不会移动已解析的 userData 路径，
  // 必须显式 setPath，保证开发与打包模式均使用 %APPDATA%/Motive Studio
  app.setName("Motive Studio");
  app.setPath("userData", path.join(app.getPath("appData"), "Motive Studio"));

  registerWindowIpc();

  let mainWindow = null;
  let serverProcess = null;
  let serverPort = null;
  let serverReady = false;
  let isQuitting = false;
  let logFile = null;

  function log(level, message) {
    const line = `[${new Date().toISOString()}] [${level}] ${message}`;
    if (isDev) console.log(line);
    if (!logFile) return;
    try {
      appendFileSync(logFile, `${line}\n`);
    } catch {
      // 日志写入失败不影响主流程
    }
  }

  function pipeChildStream(stream, label) {
    stream.setEncoding("utf8");
    let buffer = "";
    stream.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) log(label, line);
    });
    stream.on("end", () => {
      if (buffer) log(label, buffer);
    });
  }

  function showErrorAndQuit(title, detail) {
    dialog.showErrorBox(title, detail);
    app.exit(1);
  }

  /**
   * 无边框窗口的自定义窗口控制 IPC：渲染进程通过 preload 暴露的
   * window.motiveWindow 发送单向指令，按 sender 定位窗口，不持有全局引用。
   */
  function registerWindowIpc() {
    ipcMain.on("window:bridge-ready", (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      log("info", `窗口桥就绪（preload 注入成功，window=${win ? "ok" : "unknown"}）`);
    });
    ipcMain.on("window:minimize", (event) => {
      BrowserWindow.fromWebContents(event.sender)?.minimize();
    });
    ipcMain.on("window:toggle-maximize", (event) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return;
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    });
    ipcMain.on("window:close", (event) => {
      // 走 close() 触发 before-quit 优雅关停链（先停服务进程再退出）
      BrowserWindow.fromWebContents(event.sender)?.close();
    });
  }

  /** 启动 Utility Process 中的服务端，解析就绪消息中的实际端口。 */
  function startServerProcess() {
    return new Promise((resolve, reject) => {
      const resourcesDir = process.env.MOTIVE_DESKTOP_RESOURCES || process.resourcesPath;
      const entry = path.join(resourcesDir, "server-entry.mjs");
      // 打包不完整时明确报错并终止，不静默回退开发模式
      if (!existsSync(entry)) {
        reject(new Error(`服务端入口缺失：${entry}（安装包可能不完整，请重新安装）`));
        return;
      }
      if (!existsSync(path.join(resourcesDir, "web", "index.html"))) {
        reject(new Error(`前端资源缺失：${path.join(resourcesDir, "web")}（安装包可能不完整，请重新安装）`));
        return;
      }
      const expectedPort = process.env.MOTIVE_PORT || String(DEFAULT_SERVER_PORT);
      const child = utilityProcess.fork(entry, [], {
        serviceName: "motive-server",
        stdio: "pipe",
        env: {
          ...process.env,
          NODE_ENV: "production",
          MOTIVE_DATA_DIR: app.getPath("userData"),
          MOTIVE_WEB_DIST: path.join(resourcesDir, "web"),
          MOTIVE_PORT: expectedPort,
        },
      });
      serverProcess = child;

      let settled = false;
      const timer = setTimeout(() => {
        fail(new Error(`服务进程启动失败：${SERVER_START_TIMEOUT_MS / 1000}s 内未报告就绪状态`));
      }, SERVER_START_TIMEOUT_MS);

      function fail(error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          child.kill();
        } catch {
          // 子进程已退出时忽略
        }
        serverProcess = null;
        reject(error);
      }

      child.on("message", (message) => {
        if (settled) return;
        if (message?.type === "ready") {
          settled = true;
          clearTimeout(timer);
          serverPort = message.port;
          serverReady = true;
          const expectedPort = Number(process.env.MOTIVE_PORT || DEFAULT_SERVER_PORT);
          if (Number.isInteger(expectedPort) && expectedPort > 0 && serverPort !== expectedPort) {
            log(
              "warn",
              `预期端口 ${expectedPort} 被占用，已回退随机端口 ${serverPort}（界面偏好经服务端设置恢复）`,
            );
          }
          log("info", `服务就绪 · http://127.0.0.1:${serverPort}`);
          resolve(child);
          return;
        }
        if (message?.type === "error") {
          fail(new Error(message.message || "服务进程报告启动失败"));
        }
      });

      child.on("exit", (code) => {
        if (!settled) {
          fail(new Error(`服务进程启动失败：就绪前退出（exit code ${code}）`));
          return;
        }
        serverProcess = null;
        serverReady = false;
        if (!isQuitting) {
          log("error", `服务进程意外退出（exit code ${code}）`);
          showErrorAndQuit(
            "Motive Studio 服务已停止",
            `后端服务进程意外退出（exit code ${code}），应用将关闭。\n请重新启动应用；若反复出现，请查看日志：\n${logFile}`,
          );
        }
      });

      pipeChildStream(child.stdout, "server");
      pipeChildStream(child.stderr, "server");
    });
  }

  /**
   * 轮询 /api/health 直到通过或超时。
   * 必须校验响应体 service === "motive-studio"，防止连接到恰好占用端口的其他进程。
   * 错误分类：健康检查超时（整体超时）/ 服务身份不匹配（立即失败）。
   */
  async function waitHealthy(port) {
    const deadline = Date.now() + HEALTH_CHECK_TIMEOUT_MS;
    let lastError = null;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
          signal: AbortSignal.timeout(1_000),
        });
        if (response.ok) {
          const body = await response.json().catch(() => null);
          if (body?.service === "motive-studio") return;
          throw new Error(
            `服务身份不匹配：/api/health 返回 service=${JSON.stringify(body?.service ?? null)}，期望 "motive-studio"`,
          );
        }
        lastError = new Error(`健康检查返回 ${response.status}`);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("服务身份不匹配")) throw error;
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, HEALTH_CHECK_INTERVAL_MS));
    }
    throw new Error(
      `健康检查超时（${HEALTH_CHECK_TIMEOUT_MS / 1000}s）：${lastError instanceof Error ? lastError.message : lastError}`,
    );
  }

  function isExternalHttp(target, currentOrigin) {
    try {
      const url = new URL(target);
      return (url.protocol === "http:" || url.protocol === "https:") && url.origin !== currentOrigin;
    } catch {
      return false;
    }
  }

  function createWindow(url) {
    const currentOrigin = new URL(url).origin;
    const win = new BrowserWindow({
      width: 1_440,
      height: 900,
      minWidth: 1_024,
      minHeight: 700,
      show: false,
      autoHideMenuBar: true,
      // 无边框：系统标题栏由应用内 header（拖拽区 + 最小化/关闭按钮）替代
      frame: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        preload: preloadPath,
      },
    });
    mainWindow = win;

    // 不允许不受限制的窗口弹出；外部 http(s) 链接交给系统浏览器
    win.webContents.setWindowOpenHandler(({ url: target }) => {
      if (isExternalHttp(target, currentOrigin)) shell.openExternal(target);
      return { action: "deny" };
    });

    // 禁止导航离开应用源；外部 http(s) 转系统浏览器，其余一律拦截
    win.webContents.on("will-navigate", (event, target) => {
      if (isExternalHttp(target, currentOrigin)) {
        event.preventDefault();
        shell.openExternal(target);
        return;
      }
      if (!target.startsWith(currentOrigin)) event.preventDefault();
    });

    win.on("ready-to-show", () => win.show());
    win.on("closed", () => {
      mainWindow = null;
    });
    win.webContents.on("did-finish-load", () => log("info", `窗口已加载 ${url}`));

    if (isDev) {
      win.webContents.on("did-fail-load", (_event, code, description, validatedURL, isMainFrame) => {
        if (!isMainFrame) return;
        showErrorAndQuit(
          "开发服务加载失败",
          `无法加载 ${validatedURL || url}（${code} ${description}）。\n请确认开发服务已启动（npm run dev）。`,
        );
      });
    }

    win.loadURL(url).catch(() => {
      // 加载失败由 did-fail-load 统一处理
    });
  }

  /** 优雅停止服务进程：发送 shutdown，超时强制 kill。 */
  function shutdownServer() {
    return new Promise((resolve) => {
      const child = serverProcess;
      if (!child) return resolve();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      const timer = setTimeout(() => {
        log("warn", "服务关闭超时，强制终止");
        try {
          child.kill();
        } catch {
          // 忽略
        }
        finish();
      }, SERVER_SHUTDOWN_TIMEOUT_MS);
      child.on("exit", () => {
        clearTimeout(timer);
        finish();
      });
      try {
        child.postMessage({ type: "shutdown" });
      } catch {
        try {
          child.kill();
        } catch {
          // 忽略
        }
        clearTimeout(timer);
        finish();
      }
    });
  }

  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on("window-all-closed", () => {
    app.quit();
  });

  app.on("before-quit", (event) => {
    if (isQuitting) return;
    isQuitting = true;
    event.preventDefault();
    shutdownServer().finally(() => app.quit());
  });

  app.whenReady().then(async () => {
    const userData = app.getPath("userData");
    mkdirSync(path.join(userData, "logs"), { recursive: true });
    logFile = path.join(userData, "logs", "main.log");
    log(
      "info",
      `Motive Studio 启动 · Electron ${process.versions.electron} · Node ${process.versions.node} · ${isDev ? "development" : "production"}`,
    );

    let url;
    if (isDev) {
      // 开发模式：复用现有 Vite + Express 开发服务，不启动生产 Bundle
      url = DEV_URL;
    } else {
      try {
        await startServerProcess();
        await waitHealthy(serverPort);
        log("info", "服务健康检查通过");
      } catch (error) {
        log("error", `服务启动失败：${error instanceof Error ? error.message : error}`);
        showErrorAndQuit(
          "Motive Studio 启动失败",
          `后端服务未能启动：\n\n${error instanceof Error ? error.message : error}\n\n应用将退出。若反复出现，请查看日志：\n${logFile}`,
        );
        return;
      }
      url = `http://127.0.0.1:${serverPort}`;
    }
    createWindow(url);
  }).catch((error) => {
    showErrorAndQuit(
      "Motive Studio 启动失败",
      `初始化异常：\n\n${error instanceof Error ? (error.stack || error.message) : String(error)}`,
    );
  });
}
