import { build } from "esbuild";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 将服务端桌面入口（apps/server/src/desktop.ts）打包为自包含的
 * dist/server.mjs：express、qrcode、@motive/shared 全部内联，
 * node: 内置模块保留，Utility Process 运行时不依赖任何 node_modules
 * 与源码目录。构建失败立即非零退出，不产出不完整文件。
 *
 * 构建前先删除旧产物：失败时旧文件不存在，配合 check-dist-inputs
 * 拦截，杜绝将上一次构建的旧产物误判为本次结果。清理范围仅限
 * dist/ 构建输出目录。
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, "..");
const outDir = path.join(desktopRoot, "dist");

rmSync(path.join(outDir, "server.mjs"), { force: true });
rmSync(path.join(outDir, "server.mjs.map"), { force: true });

try {
  await build({
    entryPoints: [path.resolve(desktopRoot, "../server/src/desktop.ts")],
    outfile: path.join(outDir, "server.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    packages: "bundle",
    sourcemap: true,
    logLevel: "info",
    // ESM 输出中 CJS 依赖（express 等）运行时 require 外置的 node 内置模块，
    // 通过 createRequire 提供真实的 require，避免 "Dynamic require of ..." 报错
    banner: {
      js: `import { createRequire as __createRequire } from "node:module";\nconst require = __createRequire(import.meta.url);`,
    },
  });
} catch {
  // esbuild 已输出诊断信息
  process.exit(1);
}
