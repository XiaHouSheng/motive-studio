import { Router } from "express";
import type { Request, Response } from "express";
import type { BackupImage, WorkspaceData } from "@motive/shared";
import type { BackupAssetFile, WorkspaceRepository } from "../repositories/workspace-repository.js";
import type { AssetStore } from "../services/asset-store.js";
import { HttpError } from "../http-error.js";
import { readBody } from "./validation.js";

const collections = [
  "groups",
  "questions",
  "steps",
  "subs",
  "turns",
  "tags",
  "explanations",
] as const;

function assertWorkspaceData(value: unknown): WorkspaceData {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "INVALID_BACKUP", "备份数据格式不正确");
  }

  const record = value as Record<string, unknown>;
  for (const key of collections) {
    const list = record[key];
    if (!Array.isArray(list)) {
      throw new HttpError(400, "INVALID_BACKUP", `备份数据缺少 ${key} 列表`);
    }
    for (const item of list) {
      if (
        typeof item !== "object" ||
        item === null ||
        typeof (item as { id?: unknown }).id !== "string"
      ) {
        throw new HttpError(400, "INVALID_BACKUP", `备份数据中的 ${key} 项缺少 id`);
      }
    }
  }

  return value as WorkspaceData;
}

/** 校验可选的备份内嵌图片；老版本备份没有 images 字段 */
function assertBackupImages(value: unknown): BackupImage[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new HttpError(400, "INVALID_BACKUP", "备份数据的 images 字段格式不正确");
  }
  return value.map((item) => {
    if (typeof item !== "object" || item === null) {
      throw new HttpError(400, "INVALID_BACKUP", "备份数据的 images 项格式不正确");
    }
    const record = item as Record<string, unknown>;
    if (
      typeof record.id !== "string" ||
      typeof record.mimeType !== "string" ||
      typeof record.data !== "string"
    ) {
      throw new HttpError(400, "INVALID_BACKUP", "备份数据的 images 项缺少必要字段");
    }
    return { id: record.id, mimeType: record.mimeType, data: record.data };
  });
}

export function createBackupRouter(repository: WorkspaceRepository, assetStore: AssetStore): Router {
  const router = Router();

  router.get("/backup", (req: Request, res: Response) => {
    const payload = repository.exportBackup();
    const includeImages = req.query.images === "1" || req.query.images === "true";
    if (!includeImages) {
      res.json(payload);
      return;
    }
    const images: BackupImage[] = repository
      .listLinkedAssetRows()
      .map((asset) => ({
        id: asset.id,
        mimeType: asset.mime_type,
        data: assetStore.read(asset.storage_path).toString("base64"),
      }));
    res.json({ ...payload, images });
  });

  router.post("/backup/import", (req: Request, res: Response) => {
    const body = readBody(req.body);
    if (body.version !== 1) {
      throw new HttpError(400, "INVALID_BACKUP", "不支持的备份版本");
    }
    const data = assertWorkspaceData(body.data);
    const backupImages = assertBackupImages((body as Record<string, unknown>).images);

    // 先校验内容并落盘，再在事务内整体替换工作区；失败时清理已写文件
    const assetFiles: BackupAssetFile[] = [];
    try {
      for (const image of backupImages ?? []) {
        const prepared = assetStore.prepare(image.mimeType, image.data);
        assetFiles.push({ id: image.id, ...assetStore.write(prepared) });
      }

      res.json(
        repository.replaceWorkspace(data, assetFiles.length > 0 ? assetFiles : undefined),
      );
    } catch (error) {
      for (const file of assetFiles) assetStore.remove(file.storagePath);
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, "INVALID_BACKUP", "备份数据存在冲突，无法导入");
    }
  });

  return router;
}
