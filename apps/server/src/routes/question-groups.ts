import { Router } from "express";
import type { Request, Response } from "express";
import type { WorkspaceRepository } from "../repositories/workspace-repository.js";
import { readBody, readParam, readString } from "./validation.js";

export function createQuestionGroupsRouter(repository: WorkspaceRepository): Router {
  const router = Router();

  router.post("/question-groups", (req: Request, res: Response) => {
    const body = readBody(req.body);
    const title = readString(body, "title", { max: 120, label: "题组名称" });
    res.status(201).json(repository.createGroup(title));
  });

  router.patch("/question-groups/:id", (req: Request, res: Response) => {
    const body = readBody(req.body);
    const title = readString(body, "title", { max: 120, label: "题组名称" });
    res.json(repository.renameGroup(readParam(req.params, "id"), title));
  });

  router.delete("/question-groups/:id", (req: Request, res: Response) => {
    repository.deleteGroup(readParam(req.params, "id"));
    res.json({ ok: true });
  });

  return router;
}
