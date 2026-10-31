import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 将服务端桌面入口（apps/server/src/desktop.ts）打包为自包含的
 * dist/server.mjs：express、qrcode、@motive/shared 全部内联，
 * node: 内置模块保留，Utility Process 运行时不依赖任何 node_modules
 * 与源码目录。构建失败立即非零退出，不产出不完整文件。
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, "..");

try {
  await build({
    entryPoints: [path.resolve(desktopRoot, "../server/src/desktop.ts")],
    outfile: path.join(desktopRoot, "dist", "server.mjs"),
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
