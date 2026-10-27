import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webDist = path.join(root, "apps", "web", "dist");

if (!existsSync(webDist)) {
  console.error("未找到前端构建产物：apps/web/dist");
  console.error("请先运行 npm run build，再执行 npm start。");
  process.exit(1);
}

const isWindows = process.platform === "win32";
const npm = isWindows ? "npm.cmd" : "npm";

const child = spawn(npm, ["run", "start", "-w", "@motive/server"], {
  stdio: "inherit",
  shell: isWindows,
  env: { ...process.env, NODE_ENV: "production" },
});

child.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => child.kill("SIGTERM"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
