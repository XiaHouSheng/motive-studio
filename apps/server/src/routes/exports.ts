import { Router } from "express";
import type { Request, Response } from "express";
import type { WorkspaceRepository } from "../repositories/workspace-repository.js";
import {
  buildGroupFilename,
  buildGroupMarkdown,
  buildQuestionFilename,
  buildQuestionMarkdown,
} from "../services/export/markdown.js";
import { readParam } from "./validation.js";

function sendMarkdown(res: Response, filename: string, markdown: string): void {
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="motive-export.md"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );
  res.send(markdown);
}

export function createExportRouter(repository: WorkspaceRepository): Router {
  const router = Router();

  router.get("/exports/questions/:id", (req: Request, res: Response) => {
    const data = repository.getQuestionExport(readParam(req.params, "id"));
    sendMarkdown(res, buildQuestionFilename(data), buildQuestionMarkdown(data));
  });

  router.get("/exports/groups/:id", (req: Request, res: Response) => {
    const data = repository.getGroupExport(readParam(req.params, "id"));
    sendMarkdown(
      res,
      buildGroupFilename(data.groupTitle),
      buildGroupMarkdown(data.groupTitle, data.questions),
    );
  });

  return router;
}
