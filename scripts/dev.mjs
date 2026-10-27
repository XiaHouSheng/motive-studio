import { spawn } from "node:child_process";
import process from "node:process";

const isWindows = process.platform === "win32";
const npm = isWindows ? "npm.cmd" : "npm";

const targets = [
  { name: "web", color: "\u001b[36m" },
  { name: "server", color: "\u001b[35m" },
];

const children = targets.map(({ name, color }) => {
  const child = spawn(npm, ["run", `dev:${name}`], {
    stdio: ["inherit", "pipe", "pipe"],
    shell: isWindows,
    env: process.env,
  });

  const prefix = `${color}[${name}]\u001b[0m `;
  const pipe = (stream, target) => {
    stream.setEncoding("utf8");
    let buffer = "";
    stream.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        target.write(prefix + line + "\n");
      }
    });
    stream.on("end", () => {
      if (buffer) target.write(prefix + buffer + "\n");
    });
  };

  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);

  child.on("exit", (code) => {
    console.log(`${prefix}已退出（code ${code ?? 0}）`);
    shutdown();
  });

  return child;
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("\u001b[36mMotive Studio\u001b[0m 开发模式：web + server 同时启动");
