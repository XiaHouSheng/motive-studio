/**
 * 讨论草稿缓存：按步骤维度把「文字 + 附图」暂存在 localStorage，
 * 切换步骤 / 重开应用后草稿仍在，发送成功后清除。
 *
 * 体积策略：图片已在前端缩放（≤1568px、≤6MB）；缓存整体超限时
 * 先降级为只存文字，再失败则静默放弃持久化（内存中的草稿不受影响）。
 */

const STORAGE_PREFIX = "motive.chatDraft.";
/** 附图缓存体积上限（base64 后的 JSON 尺寸），超过则只保留文字 */
const MAX_IMAGES_JSON_LENGTH = 2 * 1024 * 1024;

export interface ChatDraft {
  text: string;
  images: Array<{ mediaType: string; data: string }>;
}

function storageKey(stepId: string): string {
  return STORAGE_PREFIX + stepId;
}

export function loadChatDraft(stepId: string): ChatDraft | null {
  try {
    const raw = window.localStorage.getItem(storageKey(stepId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { text?: unknown; images?: unknown };
    return {
      text: typeof parsed.text === "string" ? parsed.text : "",
      images: Array.isArray(parsed.images)
        ? parsed.images.filter(
            (image): image is { mediaType: string; data: string } =>
              typeof image === "object" &&
              image !== null &&
              typeof (image as { mediaType?: unknown }).mediaType === "string" &&
              typeof (image as { data?: unknown }).data === "string",
          )
        : [],
    };
  } catch {
    return null;
  }
}

/** 防抖保存由调用方控制；这里只负责写盘与降级策略 */
export function saveChatDraft(stepId: string, draft: ChatDraft): void {
  try {
    const payload = JSON.stringify(draft);
    if (payload.length > MAX_IMAGES_JSON_LENGTH) {
      window.localStorage.setItem(storageKey(stepId), JSON.stringify({ text: draft.text }));
      return;
    }
    window.localStorage.setItem(storageKey(stepId), payload);
  } catch {
    // 配额不足：降级为只存文字再试一次，仍失败则放弃持久化
    try {
      window.localStorage.setItem(storageKey(stepId), JSON.stringify({ text: draft.text }));
    } catch {
      // 内存中的草稿仍然可用，静默忽略持久化失败
    }
  }
}

export function clearChatDraft(stepId: string): void {
  try {
    window.localStorage.removeItem(storageKey(stepId));
  } catch {
    // 清理失败无碍：草稿残留只会在下次进入该步骤时被重新展示
  }
}
