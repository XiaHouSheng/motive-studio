/**
 * 聊天附图的前端预处理：统一压缩到模型友好的尺寸再随消息发送，
 * 与服务端 readOptionalImages 的限制（PNG/JPEG/WebP、单张 ≤6MB、单次 ≤4 张）对齐。
 */

export interface ChatImageAttachment {
  id: string;
  mediaType: string;
  /** 不含 data: 前缀的 base64（随请求发送的形态） */
  data: string;
  /** 含前缀的 data URL（本地预览 / 草稿缓存共用） */
  dataUrl: string;
}

export type ChatImageErrorCode = "unsupported" | "tooLarge" | "decodeFailed";

export class ChatImageError extends Error {
  readonly code: ChatImageErrorCode;
  constructor(code: ChatImageErrorCode) {
    super(code);
    this.name = "ChatImageError";
    this.code = code;
  }
}

/** 与服务端 MAX_IMAGES 保持一致 */
export const CHAT_MAX_IMAGES = 4;
/** 缩放后的单边上限：过大的截图等比缩小，模型识别效果与上下文体积更均衡 */
const MAX_DIMENSION = 1568;
/** 与服务端 MAX_IMAGE_BYTES 保持一致 */
const MAX_BYTES = 6 * 1024 * 1024;

const SUPPORTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ChatImageError("decodeFailed"));
    };
    // 保持引用直到绘制完成，避免部分浏览器提前回收
    image.decoding = "async";
    image.src = url;
    image.addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
  });
}

/** 解码并按需缩放，统一输出 PNG（保透明）或 JPEG（体积），超出上限抛 ChatImageError */
export async function fileToAttachment(file: File): Promise<ChatImageAttachment> {
  if (!SUPPORTED_TYPES.has(file.type)) throw new ChatImageError("unsupported");
  if (file.size > 25 * 1024 * 1024) throw new ChatImageError("tooLarge");

  let image: HTMLImageElement;
  try {
    image = await loadImage(file);
  } catch (error) {
    if (error instanceof ChatImageError) throw error;
    throw new ChatImageError("decodeFailed");
  }

  const ratio = Math.min(
    1,
    MAX_DIMENSION / Math.max(image.naturalWidth || 1, image.naturalHeight || 1),
  );
  const width = Math.max(1, Math.round((image.naturalWidth || 1) * ratio));
  const height = Math.max(1, Math.round((image.naturalHeight || 1) * ratio));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new ChatImageError("decodeFailed");
  context.drawImage(image, 0, 0, width, height);

  // GIF/webp 统一转 PNG；JPEG 用有损压缩控制体积
  const mediaType = file.type === "image/jpeg" ? "image/jpeg" : "image/png";
  const quality = mediaType === "image/jpeg" ? 0.9 : undefined;
  let dataUrl = canvas.toDataURL(mediaType, quality);
  if (dataUrl.length > MAX_BYTES && mediaType === "image/png") {
    // PNG 压不下去时降级 JPEG（放弃透明度换取体积）
    dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  }
  if (dataUrl.length > MAX_BYTES) throw new ChatImageError("tooLarge");

  const commaIndex = dataUrl.indexOf(",");
  const mediaMatch = /^data:([^;]+);/.exec(dataUrl);
  return {
    id: randomId(),
    mediaType: mediaMatch?.[1] ?? mediaType,
    data: dataUrl.slice(commaIndex + 1),
    dataUrl,
  };
}

/** 批量处理：超出数量上限的部分忽略并提示 */
export async function filesToAttachments(
  files: Iterable<File>,
  existingCount: number,
): Promise<{ attachments: ChatImageAttachment[]; overflow: number }> {
  const all = Array.from(files).filter((file) => file.type.startsWith("image/"));
  const room = Math.max(0, CHAT_MAX_IMAGES - existingCount);
  const picked = all.slice(0, room);
  const attachments: ChatImageAttachment[] = [];
  for (const file of picked) {
    attachments.push(await fileToAttachment(file));
  }
  return { attachments, overflow: Math.max(0, all.length - room) };
}

/** 从草稿缓存恢复为可继续编辑的附件形态 */
export function attachmentFromStored(mediaType: string, data: string): ChatImageAttachment {
  return {
    id: randomId(),
    mediaType,
    data,
    dataUrl: `data:${mediaType};base64,${data}`,
  };
}
