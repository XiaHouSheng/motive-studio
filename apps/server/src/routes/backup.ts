import { Router } from "express";
import type { Request, Response } from "express";
import type { WorkspaceData } from "@motive/shared";
import type { WorkspaceRepository } from "../repositories/workspace-repository.js";
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

export function createBackupRouter(repository: WorkspaceRepository): Router {
  const router = Router();

  router.get("/backup", (_req: Request, res: Response) => {
    res.json(repository.exportBackup());
  });

  router.post("/backup/import", (req: Request, res: Response) => {
    const body = readBody(req.body);
    if (body.version !== 1) {
      throw new HttpError(400, "INVALID_BACKUP", "不支持的备份版本");
    }
    const data = assertWorkspaceData(body.data);

    try {
      res.json(repository.replaceWorkspace(data));
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, "INVALID_BACKUP", "备份数据存在冲突，无法导入");
    }
  });

  return router;
}
