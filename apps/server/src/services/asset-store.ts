import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { HttpError } from "../http-error.js";

const ORIGINALS_DIR = "originals";

const EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

export interface PreparedImage {
  mimeType: string;
  bytes: Buffer;
  sha256: string;
}

export interface StoredImage {
  storagePath: string;
  mimeType: string;
  fileSize: number;
  sha256: string;
}

/** 读取文件头签名，不信任客户端声明的 mediaType */
export function sniffImageType(bytes: Buffer): string | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * 图片资源落盘：SQLite 只存相对路径与元数据，二进制不进数据库。
 */
export class AssetStore {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  /** 校验类型并计算哈希；此时尚未写盘，便于先按 sha256 复用已有资源 */
  prepare(mediaType: string, data: string): PreparedImage {
    const bytes = Buffer.from(data, "base64");
    if (bytes.length === 0) {
      throw new HttpError(400, "INVALID_FIELD", "图片数据不是有效的 base64");
    }
    const sniffed = sniffImageType(bytes);
    if (!sniffed) {
      throw new HttpError(400, "INVALID_FIELD", "图片格式不支持，仅支持 PNG、JPEG、WebP");
    }
    if (sniffed !== mediaType) {
      throw new HttpError(400, "INVALID_FIELD", "图片内容与声明的格式不一致");
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    return { mimeType: sniffed, bytes, sha256 };
  }

  write(prepared: PreparedImage): StoredImage {
    const fileName = `${randomUUID()}${EXTENSIONS[prepared.mimeType]}`;
    const storagePath = `${ORIGINALS_DIR}/${fileName}`;
    const absolute = path.join(this.rootDir, storagePath);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, prepared.bytes);
    return {
      storagePath,
      mimeType: prepared.mimeType,
      fileSize: prepared.bytes.length,
      sha256: prepared.sha256,
    };
  }

  read(storagePath: string): Buffer {
    return readFileSync(path.join(this.rootDir, storagePath));
  }

  remove(storagePath: string): void {
    rmSync(path.join(this.rootDir, storagePath), { force: true });
  }
}
