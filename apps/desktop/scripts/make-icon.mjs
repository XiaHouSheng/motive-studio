import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

/**
 * 从品牌标识生成 Windows 图标：仅做格式转换，不修改品牌视觉。
 *
 * - 输入 apps/web/public/logo-light.svg（自包含渐变矢量，透明背景）
 * - 渲染 256/128/64/48/32/16 六种尺寸的透明背景 PNG，并校验实际像素尺寸
 * - 合成 build/icon.ico：256×256 条目直接嵌入 PNG（Vista+ 规范），
 *   ≤48 条目构造 32bpp BMP（BGRA + AND mask）
 * - 先写临时文件，全部成功后原子替换；失败时保留原有有效 ICO
 * - 可重复执行，输出稳定
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, "..");
const LOGO_SVG = path.resolve(desktopRoot, "../web/public/logo-light.svg");
const OUT_ICO = path.join(desktopRoot, "build", "icon.ico");

const SIZES = [256, 128, 64, 48, 32, 16];
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function fail(message) {
  console.error(`[make-icon] ${message}`);
  process.exit(1);
}

/** 校验 PNG IHDR 中的实际宽高（IHDR 位于固定偏移，大端 4 字节）。 */
function pngSize(buffer) {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("输出不是有效的 PNG");
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** 32bpp BMP 条目：BITMAPINFOHEADER + 自底向上 BGRA 像素 + 全 0 AND mask。 */
function bmpEntry(width, height, rgba) {
  if (rgba.length !== width * height * 4) {
    throw new Error(`像素数据长度不符：期望 ${width * height * 4}，实际 ${rgba.length}`);
  }
  const rowBytes = width * 4;
  const maskRowBytes = ((width + 31) >> 5) << 2;
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); // biSize
  header.writeInt32LE(width, 4);
  header.writeInt32LE(height * 2, 8); // XOR + AND 两段
  header.writeUInt16LE(1, 12); // biPlanes
  header.writeUInt16LE(32, 14); // biBitCount
  header.writeUInt32LE(0, 16); // biCompression = BI_RGB
  header.writeUInt32LE(rowBytes * height, 20); // biSizeImage（XOR 段）

  const pixels = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    const src = (height - 1 - y) * rowBytes; // BMP 自底向上
    for (let x = 0; x < width; x += 1) {
      const s = src + x * 4;
      const d = y * rowBytes + x * 4;
      pixels[d] = rgba[s + 2]; // B
      pixels[d + 1] = rgba[s + 1]; // G
      pixels[d + 2] = rgba[s]; // R
      pixels[d + 3] = rgba[s + 3]; // A
    }
  }
  const mask = Buffer.alloc(maskRowBytes * height); // 全 0：不透明度由 alpha 通道决定
  return Buffer.concat([header, pixels, mask]);
}

/** 解析 ICO 文件头与目录条目（自检用）。 */
function parseIco(buffer) {
  if (buffer.length < 6 || buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) {
    throw new Error("ICO 文件头无效");
  }
  const count = buffer.readUInt16LE(4);
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    const base = 6 + i * 16;
    const width = buffer.readUInt8(base) || 256;
    const height = buffer.readUInt8(base + 1) || 256;
    const bytesInRes = buffer.readUInt32LE(base + 8);
    const offset = buffer.readUInt32LE(base + 12);
    const data = buffer.subarray(offset, offset + bytesInRes);
    entries.push({ width, height, bytesInRes, isPng: data.subarray(0, 4).equals(PNG_SIGNATURE.subarray(0, 4)) });
  }
  return { count, entries };
}

/** 图标画布必须为正方形：将原 viewBox 扩展为 max(宽,高) 的正方形并居中，图形本身不做任何修改。 */
function toSquareSvg(source) {
  const match = source.match(/viewBox="([-\d.\s]+)"/);
  if (!match) fail("SVG 缺少 viewBox，无法确定画布");
  const [x, y, width, height] = match[1].trim().split(/\s+/).map(Number);
  const side = Math.max(width, height);
  const offsetX = x - (side - width) / 2;
  const offsetY = y - (side - height) / 2;
  return source.replace(
    /^<svg[^>]*>/,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${offsetX} ${offsetY} ${side} ${side}">`,
  );
}

const svg = readFileSync(LOGO_SVG, "utf8");
const squareSvg = toSquareSvg(svg);

// 1. 渲染并校验每种尺寸
const rendered = [];
for (const size of SIZES) {
  const image = new Resvg(squareSvg, { fitTo: { mode: "width", value: size } }).render();
  const png = Buffer.from(image.asPng());
  const actual = pngSize(png);
  if (actual.width !== size || actual.height !== size) {
    fail(`PNG 尺寸不符：期望 ${size}×${size}，实际 ${actual.width}×${actual.height}`);
  }
  rendered.push({ size, png, pixels: Buffer.from(image.pixels) });
  console.log(`[make-icon] 渲染 ${size}×${size} ✓`);
}

// 2. 合成 ICO：ICONDIR + 条目目录 + 图像数据（256 嵌 PNG，其余 BMP）
const images = rendered.map(({ size, png, pixels }) => ({
  size,
  data: size === 256 ? png : bmpEntry(size, size, pixels),
}));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
const directory = Buffer.alloc(images.length * 16);
let offset = header.length + directory.length;
images.forEach(({ size, data }, index) => {
  const base = index * 16;
  directory.writeUInt8(size === 256 ? 0 : size, base);
  directory.writeUInt8(size === 256 ? 0 : size, base + 1);
  directory.writeUInt16LE(1, base + 4); // planes
  directory.writeUInt16LE(32, base + 6); // bitCount
  directory.writeUInt32LE(data.length, base + 8);
  directory.writeUInt32LE(offset, base + 12);
  offset += data.length;
});
const ico = Buffer.concat([header, directory, ...images.map((item) => item.data)]);

// 3. 自检 ICO 头与条目
const parsed = parseIco(ico);
const missing = SIZES.filter((size) => !parsed.entries.some((entry) => entry.width === size && entry.height === size));
if (parsed.count !== SIZES.length || missing.length > 0) {
  fail(`ICO 条目不完整：共 ${parsed.count} 项，缺失 ${missing.join(", ") || "无"}`);
}
if (!parsed.entries.find((entry) => entry.width === 256)?.isPng) {
  fail("256×256 条目未使用 PNG 编码");
}
console.log(`[make-icon] ICO 自检通过：${parsed.count} 个条目（${parsed.entries.map((e) => e.width).join("/")}）`);

// 4. 原子替换：临时文件必须与目标同盘（rename 不允许跨设备），失败时保留原有 ICO
mkdirSync(path.dirname(OUT_ICO), { recursive: true });
const tmpIco = `${OUT_ICO}.${process.pid}.tmp`;
try {
  writeFileSync(tmpIco, ico);
  renameSync(tmpIco, OUT_ICO);
} catch (error) {
  fail(`写入失败：${error instanceof Error ? error.message : error}`);
} finally {
  rmSync(tmpIco, { force: true });
}
console.log(`[make-icon] 已生成 ${OUT_ICO}（${ico.length} 字节）`);
