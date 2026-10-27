import type { DatabaseSync } from "node:sqlite";
import { createApp } from "./app.js";
import { HOST, PORT, isProduction } from "./config.js";
import { getLanAddresses } from "./services/lan.js";
import type { ProviderSettingsStore } from "./services/ai/provider-settings-store.js";

const app = createApp();
const db = app.locals.db as DatabaseSync;
const settingsStore = app.locals.settingsStore as ProviderSettingsStore;

// 监听前恢复已保存的 API Key（凭据存储 → 内存缓存），避免恢复完成前的请求窗口期
await settingsStore.restore();

const server = app.listen(PORT, HOST, () => {
  const mode = isProduction ? "production" : "development";
  console.log(`[server] Motive Studio 运行于 http://localhost:${PORT}（${mode}）`);
  if (HOST !== "127.0.0.1" && HOST !== "localhost" && HOST !== "::1") {
    const lanAddresses = getLanAddresses(PORT);
    if (lanAddresses.length > 0) {
      for (const address of lanAddresses) {
        console.log(`[server] 局域网地址：${address}`);
      }
      console.log(`[server] 手机拍照导入页：${lanAddresses[0]}/m（通过桌面端扫码访问）`);
    } else {
      console.log("[server] 未检测到局域网地址，手机拍照导入不可用");
    }
  }
});

// 流式对话可能持续较长时间，关闭 Node 默认的请求超时
server.requestTimeout = 0;

function shutdown() {
  server.close(() => {
    try {
      db.close();
    } catch {
      // 数据库已关闭时忽略
    }
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
