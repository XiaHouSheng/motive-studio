import { Router } from "express";
import type { Request, Response } from "express";
import { APP_VERSION } from "../config.js";

/** GitHub 仓库地址：跳转按钮、关于页与更新检查共用 */
export const GITHUB_REPO_URL = "https://github.com/XiaHouSheng/motive-studio";

/** 应用信息：版本展示与更新检查的数据源 */
export function createAppInfoRouter(): Router {
  const router = Router();

  router.get("/app/info", (_req: Request, res: Response) => {
    res.json({
      name: "Motive Studio",
      version: APP_VERSION,
      repoUrl: GITHUB_REPO_URL,
    });
  });

  return router;
}
