import { app, utilityProcess } from "electron";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * P0 运行时验证：在真实 Electron 环境中确认桌面化所需的全部运行时能力。
 *
 * 验证项：
 *  1. 内置 Node.js 版本满足 node:sqlite 要求（≥ 22.13）；
 *  2. 主进程 node:sqlite 建表 → 写入 → 读取 → 关闭（WAL 模式）；
 *  3. Utility Process（utilityProcess.fork）内同样的 node:sqlite 全周期，
 *     结果经 process.parentPort 回传主进程；
 *  4. 子进程异常退出可检测（崩溃脚本）；
 *  5. 启动失败可检测（不存在的模块路径）；
 *  6. 无响应子进程可超时强制清理，且不阻碍应用退出。
 *
 * 全部通过输出 JSON 摘要并以退出码 0 结束；任何失败退出码 1。
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const utilityDir = path.resolve(here, "..", "main");

const NODE_MIN = { major: 22, minor: 13, patch: 0 };
const FORK_TIMEOUT_MS = 15_000;
const HANG_TIMEOUT_MS = 1_500;
const GLOBAL_WATCHDOG_MS = 60_000;

/** @type {{ name: string; ok: boolean; detail?: string }[]} */
const checks = [];

function record(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function nodeVersionAtLeast(version, min) {
  const [major = 0, minor = 0, patch = 0] = version.split(".").map(Number);
  if (major !== min.major) return major > min.major;
  if (minor !== min.minor) return minor > min.minor;
  return patch >= min.patch;
}

/** node:sqlite 完整生命周期：建库 → 建表 → 写入 → 读取 → 关闭（WAL 模式）。 */
function sqliteCycle(label) {
  const dir = mkdtempSync(path.join(tmpdir(), `motive-verify-${label}-`));
  try {
    const db = new DatabaseSync(path.join(dir, "verify.db"));
    try {
      db.exec("CREATE TABLE verify (k TEXT PRIMARY KEY, v TEXT)");
      db.exec("PRAGMA journal_mode = WAL");
      db.prepare("INSERT INTO verify (k, v) VALUES (?, ?)").run("greeting", `hello-from-${label}`);
      const row = db.prepare("SELECT v FROM verify WHERE k = ?").get("greeting");
      return row !== undefined && row.v === `hello-from-${label}`;
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * 运行一个 Utility Process 子脚本，收集 message / exit / spawn 事件。
 * 超时后强制 kill 并以 timedOut 标记返回，保证不残留子进程。
 */
function runUtility(script, { timeoutMs = FORK_TIMEOUT_MS, serviceName = "motive-verify" } = {}) {
  return new Promise((resolve) => {
    const events = { messages: [], exitCode: undefined, spawned: false, timedOut: false };
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      events.timedOut = true;
      settled = true;
      try {
        child.kill();
      } catch {
        // 子进程已退出时忽略
      }
      resolve(events);
    }, timeoutMs);

    let child;
    try {
      child = utilityProcess.fork(script, [], { serviceName, stdio: "pipe" });
    } catch (error) {
      clearTimeout(timer);
      resolve({ ...events, spawnError: String(error instanceof Error ? error.message : error) });
      return;
    }

    child.on("spawn", () => {
      events.spawned = true;
    });
    child.on("message", (message) => {
      events.messages.push(message);
    });
    child.on("exit", (code) => {
      events.exitCode = code;
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(events);
    });
  });
}

async function main() {
  record(
    "主进程 Node 版本满足 node:sqlite 要求",
    nodeVersionAtLeast(process.versions.node, NODE_MIN),
    `Electron ${process.versions.electron} · Node ${process.versions.node} · Chromium ${process.versions.chrome}`,
  );

  try {
    record("主进程 node:sqlite 建表/写入/读取/关闭", sqliteCycle("main"));
  } catch (error) {
    record("主进程 node:sqlite 建表/写入/读取/关闭", false, String(error instanceof Error ? error.message : error));
  }

  // 场景 1：正常启动 + parentPort 回传 + 优雅退出
  const normal = await runUtility(path.join(utilityDir, "verify-utility.cjs"), {
    serviceName: "motive-verify-utility",
  });
  const resultMessage = normal.messages.find((m) => m && m.type === "result");
  const normalOk =
    normal.spawned === true &&
    normal.timedOut === false &&
    normal.exitCode === 0 &&
    resultMessage?.ok === true;
  record(
    "Utility Process 启动、node:sqlite 全周期并经 parentPort 回传",
    normalOk,
    normalOk ? `子进程 Node ${resultMessage?.node}` : `events=${JSON.stringify(normal)}`,
  );

  // 场景 2：子进程异常退出可检测
  const crash = await runUtility(path.join(utilityDir, "verify-utility-crash.cjs"), {
    serviceName: "motive-verify-crash",
  });
  const crashOk = !crash.timedOut && typeof crash.exitCode === "number" && crash.exitCode !== 0;
  record("子进程异常退出可检测", crashOk, `exitCode=${crash.exitCode}`);

  // 场景 3：启动失败（不存在的模块）可检测
  const missing = await runUtility(path.join(utilityDir, "verify-utility-missing.cjs"), {
    serviceName: "motive-verify-missing",
  });
  const missingOk =
    missing.spawnError !== undefined ||
    (!missing.timedOut && missing.spawned === false) ||
    (!missing.timedOut && typeof missing.exitCode === "number" && missing.exitCode !== 0);
  record(
    "启动失败（无效模块路径）可检测",
    missingOk,
    missing.spawnError ? `spawnError=${missing.spawnError}` : `events=${JSON.stringify(missing)}`,
  );

  // 场景 4：无响应子进程超时强制清理
  const hang = await runUtility(path.join(utilityDir, "verify-utility-hang.cjs"), {
    timeoutMs: HANG_TIMEOUT_MS,
    serviceName: "motive-verify-hang",
  });
  const hangOk = hang.timedOut === true && hang.exitCode === undefined;
  record("无响应子进程超时强制清理", hangOk, hangOk ? `已 kill（${HANG_TIMEOUT_MS}ms 超时）` : `events=${JSON.stringify(hang)}`);

  const passed = checks.every((check) => check.ok);
  const summary = {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    utilityNode: resultMessage?.node ?? null,
    passed,
    checks,
  };
  console.log(`\n${JSON.stringify(summary, null, 2)}`);
  return passed;
}

const watchdog = setTimeout(() => {
  console.error("FAIL  全局看门狗超时，验证脚本未在预期时间内收敛");
  app.exit(2);
}, GLOBAL_WATCHDOG_MS);
watchdog.unref();

app
  .whenReady()
  .then(main)
  .then((passed) => {
    app.exit(passed ? 0 : 1);
  })
  .catch((error) => {
    console.error("FAIL  验证脚本自身异常：", error);
    app.exit(1);
  });
