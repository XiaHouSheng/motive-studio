import { Router } from "express";
import type { Request, Response } from "express";
import type { WorkspaceRepository } from "../repositories/workspace-repository.js";
import { readBody, readParam, readString } from "./validation.js";

/** 试卷分组：题组之下的二级分组，题目实际归属在这一层 */
export function createPaperGroupsRouter(repository: WorkspaceRepository): Router {
  const router = Router();

  router.post("/question-groups/:id/paper-groups", (req: Request, res: Response) => {
    const body = readBody(req.body);
    const title = readString(body, "title", { max: 120, label: "试卷分组名称" });
    res.status(201).json(
      repository.createPaperGroup(readParam(req.params, "id"), title),
    );
  });

  router.patch("/paper-groups/:id", (req: Request, res: Response) => {
    const body = readBody(req.body);
    const title = readString(body, "title", { max: 120, label: "试卷分组名称" });
    res.json(repository.renamePaperGroup(readParam(req.params, "id"), title));
  });

  router.delete("/paper-groups/:id", (req: Request, res: Response) => {
    repository.deletePaperGroup(readParam(req.params, "id"));
    res.json({ ok: true });
  });

  return router;
}
