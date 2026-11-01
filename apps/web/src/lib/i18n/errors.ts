import { ApiError } from "@/lib/api";
import { errorCodeToKey } from "./error-keys";
import type { DictionaryKey } from "./zh-CN";

type Translate = (key: DictionaryKey) => string;

/**
 * 把 API 错误翻译为当前语言的用户提示：
 * 已知错误码按词条翻译；未知错误码保留服务端原始消息；
 * 非 ApiError 的普通 Error 原样透出。
 */
export function translateApiError(t: Translate, error: unknown): string {
  if (error instanceof ApiError) {
    const key = errorCodeToKey(error.code);
    if (key) return t(key);
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
