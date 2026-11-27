import { build } from "esbuild";
import { readFileSync, rmSync } from "node:fs";
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

// 打包时注入应用版本号（生产运行时无法读取源码 package.json）
const desktopPackageJson = JSON.parse(
  readFileSync(path.join(desktopRoot, "package.json"), "utf8"),
);
const appVersion = typeof desktopPackageJson.version === "string"
  ? desktopPackageJson.version
  : "unknown";

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
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
    },
    // ESM 输出中 CJS 依赖（express 等）运行时 require 外置的 node 内置模块，
    // 通过 createRequire 提供真实的 require，避免 "Dynamic require of ..." 报错
    banner: {
      js: [
        `import { createRequire as __createRequire } from "node:module";`,
        `const require = __createRequire(import.meta.url);`,
        // pdf-parse→pdfjs-dist 的 display/canvas 顶层执行 new DOMMatrix()，
        // Utility Process（纯 Node）无此浏览器全局；服务端仅做文本提取，
        // 不会触达 canvas 渲染路径，恒等矩阵桩足够通过模块求值
        `const __MotiveDOMMatrix = globalThis.DOMMatrix ?? class DOMMatrix {`,
        `  constructor() {`,
        `    this.is2D = true;`,
        `    this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;`,
        `  }`,
        `};`,
      ].join("\n"),
    },
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
      // 把 bundle 内所有裸 DOMMatrix 引用替换为上述桩（属性访问不受影响）
      DOMMatrix: "__MotiveDOMMatrix",
    },
  });
} catch {
  // esbuild 已输出诊断信息
  process.exit(1);
}
