// Utility Process 内运行：加载 esbuild 打包的服务端（server.mjs），
// 经 process.parentPort 与主进程通信。
// 协议：→ ready{port, host} / error{message}；← shutdown。

const SHUTDOWN_FORCE_MS = 8_000;

async function main() {
  const { parentPort } = process;
  const dataDir = process.env.MOTIVE_DATA_DIR;
  if (!dataDir) {
    throw new Error("缺少 MOTIVE_DATA_DIR 环境变量");
  }

  const { startDesktopServer } = await import("./server.mjs");
  const server = await startDesktopServer({ dataDir });

  // 先注册消息处理再报告就绪，避免 shutdown 消息竞争
  parentPort.on("message", (message) => {
    // 主→子消息被 MessagePort 包裹在 { data } 中，兼容两种结构
    const payload = message?.data ?? message;
    if (payload?.type !== "shutdown") return;
    console.log("[desktop] 收到 shutdown，开始优雅关闭");
    const force = setTimeout(() => {
      console.error("[desktop] 优雅关闭超时，强制退出");
      process.exit(1);
    }, SHUTDOWN_FORCE_MS);
    server
      .close()
      .catch((error) => {
        console.error("[desktop] 服务关闭出错：", error);
      })
      .finally(() => process.exit(0));
  });

  parentPort.postMessage({ type: "ready", port: server.port, host: server.host });
  console.log(`[desktop] 服务已就绪 · http://127.0.0.1:${server.port}`);
}

main().catch((error) => {
  const message = error instanceof Error ? (error.stack || error.message) : String(error);
  console.error("[desktop] 服务启动失败：", message);
  try {
    process.parentPort.postMessage({ type: "error", message });
  } catch {
    // 主进程可能已退出
  }
  process.exit(1);
});
