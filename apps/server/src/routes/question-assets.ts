import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../http-error.js";
import type { WorkspaceRepository } from "../repositories/workspace-repository.js";
import { toHttpError } from "../services/ai/errors.js";
import type { AssetStore } from "../services/asset-store.js";
import { attachImages } from "../services/question-image.js";
import { readImages } from "./image-input.js";
import { isLoopbackRequest } from "./loopback.js";
import { readBody, readParam } from "./validation.js";

export function createQuestionAssetsRouter(
  repository: WorkspaceRepository,
  store: AssetStore,
): Router {
  const router = Router();

  router.post(
    "/questions/:id/assets",
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const questionId = readParam(req.params, "id");
        const images = readImages(readBody(req.body));
        attachImages(repository, store, [questionId], images);
        res.status(201).json({ assets: repository.listQuestionAssets(questionId) });
      } catch (error) {
        next(error instanceof HttpError ? error : toHttpError(error));
      }
    },
  );

  router.get("/questions/:id/assets", (req: Request, res: Response) => {
    res.json({ assets: repository.listQuestionAssets(readParam(req.params, "id")) });
  });

  router.delete(
    "/questions/:id/assets/:assetId",
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const questionId = readParam(req.params, "id");
        const assetId = readParam(req.params, "assetId");
        const remaining = repository.unlinkQuestionAsset(questionId, assetId);
        if (remaining === 0) {
          const asset = repository.getAsset(assetId);
          if (asset) {
            repository.deleteAssetRecord(assetId);
            store.remove(asset.storage_path);
          }
        }
        res.json({ ok: true });
      } catch (error) {
        next(error instanceof HttpError ? error : toHttpError(error));
      }
    },
  );

  // 原图只允许本机回环读取，避免局域网内其他设备拿到题目截图
  router.get("/assets/:assetId", (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!isLoopbackRequest(req)) {
        throw new HttpError(403, "UNAUTHORIZED", "仅允许在桌面端本机查看题目图片");
      }
      const asset = repository.getAsset(readParam(req.params, "assetId"));
      if (!asset) throw new HttpError(404, "NOT_FOUND", "图片不存在");
      res.setHeader("Content-Type", asset.mime_type);
      res.setHeader("Cache-Control", "no-store");
      res.send(store.read(asset.storage_path));
    } catch (error) {
      next(error instanceof HttpError ? error : toHttpError(error));
    }
  });

  return router;
}
