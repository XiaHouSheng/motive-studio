import { Router } from "express";
import type { Request, Response } from "express";

export const healthRouter = Router();

healthRouter.get("/", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    service: "motive-studio",
    version: "0.1.0",
    time: Date.now(),
  });
});
