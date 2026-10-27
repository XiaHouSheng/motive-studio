import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const isProduction = process.env.NODE_ENV === "production";
export const HOST = process.env.HOST ?? "0.0.0.0";
export const PORT = Number(process.env.PORT ?? 3001);
export const WEB_DIST = path.resolve(here, "../../web/dist");
export const DATA_DIR = path.resolve(here, "../../../data");
export const DB_FILE = path.join(DATA_DIR, "motive.db");
