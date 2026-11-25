import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const isProduction = process.env.NODE_ENV === "production";
export const HOST = process.env.HOST ?? "0.0.0.0";
export const PORT = Number(process.env.PORT ?? 3001);
export const WEB_DIST = process.env.MOTIVE_WEB_DIST
  ? path.resolve(process.env.MOTIVE_WEB_DIST)
  : path.resolve(here, "../../web/dist");
export const DATA_DIR = path.resolve(here, "../../../data");
export const DB_FILE = path.join(DATA_DIR, "motive.db");
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

/** 桌面版打包时由 esbuild define 注入版本号；开发态回退读取 package.json */
declare const __APP_VERSION__: string | undefined;

function readLocalVersion(): string {
  try {
    const raw = readFileSync(path.resolve(here, "../package.json"), "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    if (parsed.version) return parsed.version;
  } catch {
    // 打包后的运行环境可能没有源码目录，忽略
  }
  return "unknown";
}

export const APP_VERSION: string =
  typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : readLocalVersion();
