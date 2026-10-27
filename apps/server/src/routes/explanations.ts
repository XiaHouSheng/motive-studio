import { Router } from "express";
import type { Request, Response } from "express";
import type { WorkspaceRepository } from "../repositories/workspace-repository.js";
import { readParam } from "./validation.js";

export function createExplanationsRouter(repository: WorkspaceRepository): Router {
  const router = Router();

  router.delete("/explanations/:id", (req: Request, res: Response) => {
    repository.deleteExplanation(readParam(req.params, "id"));
    res.json({ ok: true });
  });

  return router;
}
