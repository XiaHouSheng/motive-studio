import type { DatabaseSync } from "node:sqlite";
import { createApp } from "./app.js";
import { HOST, PORT, isProduction } from "./config.js";

const app = createApp();
const db = app.locals.db as DatabaseSync;

const server = app.listen(PORT, HOST, () => {
  console.log(
    `[server] Motive Studio 运行于 http://${HOST}:${PORT}（${isProduction ? "production" : "development"}）`,
  );
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
