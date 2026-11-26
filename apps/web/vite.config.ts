import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "node:path";

/**
 * 把 pdfjs-dist 运行时资源（CJK CMap、标准 14 字体、wasm 解码器）复制进 public/pdfjs。
 * 没有这些资源，未内嵌字体的中文 PDF（CID 字体 / 标准 14 字体）渲染成图片时会丢字。
 * 以 pdfjs-dist 版本号做标记，版本不变则跳过重复复制；public 目录会随 dev 服务与
 * vite build 自动分发，Electron 端打包 ../web/dist 后同样可用。
 */
function copyPdfjsAssets(): Plugin {
  const pdfjsDist = path.resolve(import.meta.dirname, "../../node_modules/pdfjs-dist");
  const dest = path.resolve(import.meta.dirname, "public/pdfjs");
  const dirs = ["cmaps", "standard_fonts", "wasm"] as const;

  return {
    name: "copy-pdfjs-assets",
    buildStart() {
      const version = JSON.parse(
        fs.readFileSync(path.join(pdfjsDist, "package.json"), "utf8"),
      ).version as string;
      const marker = path.join(dest, ".pdfjs-version");
      if (fs.existsSync(marker) && fs.readFileSync(marker, "utf8") === version) return;

      fs.rmSync(dest, { recursive: true, force: true });
      for (const dir of dirs) {
        fs.cpSync(path.join(pdfjsDist, dir), path.join(dest, dir), { recursive: true });
      }
      fs.writeFileSync(marker, version);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), copyPdfjsAssets()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: false,
      },
    },
  },
});
