// P0 验证：Utility Process 内的 node:sqlite 完整生命周期，结果经 parentPort 回传。
const { DatabaseSync } = require("node:sqlite");
const { mkdtempSync, rmSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function run() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "motive-verify-utility-"));
  try {
    const db = new DatabaseSync(path.join(dir, "verify.db"));
    try {
      db.exec("CREATE TABLE verify (k TEXT PRIMARY KEY, v TEXT)");
      db.exec("PRAGMA journal_mode = WAL");
      db.prepare("INSERT INTO verify (k, v) VALUES (?, ?)").run("greeting", "hello-from-utility");
      const row = db.prepare("SELECT v FROM verify WHERE k = ?").get("greeting");
      return { ok: row !== undefined && row.v === "hello-from-utility" };
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

try {
  const result = run();
  process.parentPort.postMessage({ type: "result", ...result, node: process.versions.node });
  process.exit(0);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.parentPort.postMessage({ type: "result", ok: false, message, node: process.versions.node });
  process.exit(1);
}
