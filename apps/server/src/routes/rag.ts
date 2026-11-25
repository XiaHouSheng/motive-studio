import { Router } from "express";
import type { Request, Response } from "express";

/**
 * RAG（检索增强问答）预留入口：
 * 当前仅暴露状态端点，前端入口据此展示准备中的占位；
 * 后续索引构建、检索与问答能力在此路由下扩展。
 */
export function createRagRouter(): Router {
  const router = Router();

  router.get("/rag/status", (_req: Request, res: Response) => {
    res.json({ enabled: false, stage: "preparing" });
  });

  return router;
}
