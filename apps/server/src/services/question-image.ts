import { HttpError } from "../http-error.js";
import type { WorkspaceRepository } from "../repositories/workspace-repository.js";
import type { ImportImage } from "./ai/image-import-generator.js";
import type { AssetStore } from "./asset-store.js";

export const MAX_ASSETS_PER_QUESTION = 8;

/**
 * 保存图片并按 sha256 复用已有资源，再关联到给定题目。
 * 返回本次涉及的资源 id（已存在的资源也会返回）。
 */
export function attachImages(
  repository: WorkspaceRepository,
  store: AssetStore,
  questionIds: string[],
  images: ImportImage[],
): string[] {
  if (images.length === 0 || questionIds.length === 0) return [];

  const prepared = images.map((image) => store.prepare(image.mediaType, image.data));
  const assetIds = prepared.map((item) => {
    const existing = repository.findAssetBySha256(item.sha256);
    if (existing) return existing.id;
    return repository.createAsset(store.write(item)).id;
  });

  // 先整体校验关联上限，避免中途失败留下半套关联
  for (const questionId of questionIds) {
    const current = repository.listQuestionAssets(questionId).map((asset) => asset.id);
    const merged = new Set([...current, ...assetIds]);
    if (merged.size > MAX_ASSETS_PER_QUESTION) {
      throw new HttpError(
        400,
        "INVALID_FIELD",
        `单题最多关联 ${MAX_ASSETS_PER_QUESTION} 张图片`,
      );
    }
  }

  for (const questionId of questionIds) {
    repository.linkAssets(questionId, assetIds);
  }
  return assetIds;
}
