import type { ImportImage } from "../services/ai/image-import-generator.js";
import { HttpError } from "../http-error.js";

export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
export const SUPPORTED_MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp"];

export function readImages(body: Record<string, unknown>): ImportImage[] {
  const rawImages = body.images;
  if (!Array.isArray(rawImages) || rawImages.length === 0) {
    throw new HttpError(400, "INVALID_FIELD", "请至少提供一张图片");
  }
  if (rawImages.length > MAX_IMAGES) {
    throw new HttpError(400, "INVALID_FIELD", `单次最多上传 ${MAX_IMAGES} 张图片`);
  }

  return rawImages.map((item, index) => {
    const label = `第 ${index + 1} 张图片`;
    if (typeof item !== "object" || item === null) {
      throw new HttpError(400, "INVALID_FIELD", `${label}格式不正确`);
    }
    const record = item as { mediaType?: unknown; data?: unknown };
    const mediaType = typeof record.mediaType === "string" ? record.mediaType.trim() : "";
    if (!SUPPORTED_MEDIA_TYPES.includes(mediaType)) {
      throw new HttpError(400, "INVALID_FIELD", `${label}格式不支持，仅支持 PNG、JPEG、WebP`);
    }
    const data = typeof record.data === "string" ? record.data.trim() : "";
    if (!data) {
      throw new HttpError(400, "INVALID_FIELD", `${label}缺少图片数据`);
    }
    const bytes = Buffer.byteLength(data, "base64");
    if (bytes === 0) {
      throw new HttpError(400, "INVALID_FIELD", `${label}数据不是有效的 base64`);
    }
    if (bytes > MAX_IMAGE_BYTES) {
      throw new HttpError(400, "INVALID_FIELD", `${label}超过 6MB，请压缩后再试`);
    }
    return { mediaType, data };
  });
}
