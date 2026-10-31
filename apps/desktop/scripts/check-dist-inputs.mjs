import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 打包前输入完整性检查：任一输入缺失或为空立即非零退出，
 * 杜绝使用不完整或上一次构建的旧产物打包。
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, "..");

const REQUIRED_INPUTS = [
  "dist/server.mjs",
  "dist/server.mjs.map",
  "main/server-entry.mjs",
  "../web/dist/index.html",
  "build/icon.ico",
];

const missing = [];
for (const relative of REQUIRED_INPUTS) {
  const absolute = path.resolve(desktopRoot, relative);
  try {
    if (statSync(absolute).size <= 0) {
      missing.push(`${relative}（文件为空）`);
    }
  } catch {
    missing.push(relative);
  }
}

if (missing.length > 0) {
  console.error("[check-dist-inputs] 打包输入不完整，禁止打包：");
  for (const item of missing) console.error(`  - ${item}`);
  console.error("[check-dist-inputs] 请先完整执行 npm run build:desktop（web 构建 + server bundle）。");
  process.exit(1);
}

console.log(`[check-dist-inputs] 全部 ${REQUIRED_INPUTS.length} 项打包输入就绪`);
