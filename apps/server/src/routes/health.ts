import { Router } from "express";
import type { Request, Response } from "express";

export const healthRouter = Router();

/** 应用版本，随每次发布更新（供桌面壳与诊断核对） */
export const APP_VERSION = "0.3.0";

healthRouter.get("/", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    service: "motive-studio",
    version: APP_VERSION,
    time: Date.now(),
  });
});
