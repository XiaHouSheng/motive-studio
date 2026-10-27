import { Router } from "express";
import type { Request, Response } from "express";
import type { WorkspaceRepository } from "../repositories/workspace-repository.js";

export function createBootstrapRouter(repository: WorkspaceRepository): Router {
  const router = Router();

  router.get("/bootstrap", (_req: Request, res: Response) => {
    res.json(repository.getWorkspace());
  });

  return router;
}
