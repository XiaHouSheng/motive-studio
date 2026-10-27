import { Router } from "express";
import type { Request, Response } from "express";
import type { ExplanationStatus, ImagePolicy } from "@motive/shared";
import type { WorkspaceRepository } from "../repositories/workspace-repository.js";
import { HttpError } from "../http-error.js";
import {
  readBody,
  readOptionalInteger,
  readOptionalString,
  readParam,
  readString,
  readStringArray,
} from "./validation.js";

const imagePolicies: ImagePolicy[] = ["auto", "always", "never"];

const explanationStatuses: ExplanationStatus[] = [
  "pending",
  "processing",
  "completed",
  "failed",
];

export function createQuestionsRouter(repository: WorkspaceRepository): Router {
  const router = Router();

  router.post("/questions", (req: Request, res: Response) => {
    const body = readBody(req.body);
    const groupId = readString(body, "groupId", { max: 200, label: "题组 ID" });
    const content = readString(body, "content", { max: 40_000, label: "题目内容" });
    res.status(201).json(repository.createQuestion(groupId, content));
  });

  router.patch("/questions/:id", (req: Request, res: Response) => {
    const body = readBody(req.body);
    const content = readOptionalString(body, "content", {
      max: 40_000,
      label: "题目内容",
    });
    const groupId = readOptionalString(body, "groupId", { max: 200, label: "题组 ID" });

    if (content === undefined && groupId === undefined) {
      throw new HttpError(400, "INVALID_BODY", "没有需要更新的字段");
    }

    res.json(
      repository.updateQuestion(readParam(req.params, "id"), { content, groupId }),
    );
  });

  router.patch("/questions/:id/image-policy", (req: Request, res: Response) => {
    const body = readBody(req.body);
    const policy = readString(body, "imagePolicy", { max: 20, label: "图片策略" });
    if (!imagePolicies.includes(policy as ImagePolicy)) {
      throw new HttpError(400, "INVALID_FIELD", "图片策略只能是 auto、always 或 never");
    }
    res.json(
      repository.setQuestionImagePolicy(readParam(req.params, "id"), policy as ImagePolicy),
    );
  });

  router.delete("/questions/:id", (req: Request, res: Response) => {
    repository.deleteQuestion(readParam(req.params, "id"));
    res.json({ ok: true });
  });

  router.post("/questions/:id/steps", (req: Request, res: Response) => {
    const body = readBody(req.body);
    const title = readString(body, "title", { max: 200, label: "步骤标题" });
    const content = readString(body, "content", { max: 40_000, label: "步骤内容" });
    const order = readOptionalInteger(body, "order", { label: "步骤序号" });
    res.status(201).json(
      repository.createStep(readParam(req.params, "id"), { title, content, order }),
    );
  });

  router.post("/questions/:id/explanations", (req: Request, res: Response) => {
    const body = readBody(req.body);
    const content = readString(body, "content", { max: 80_000, label: "详解内容" });
    const summary = readString(body, "summary", { max: 600, label: "详解摘要" });
    const turnIds = readStringArray(body, "turnIds", "纳入讨论");
    const statusValue = readOptionalString(body, "status", { max: 40, label: "详解状态" });

    if (statusValue !== undefined && !explanationStatuses.includes(statusValue as ExplanationStatus)) {
      throw new HttpError(400, "INVALID_FIELD", "详解状态不合法");
    }

    res.status(201).json(
      repository.createExplanation(readParam(req.params, "id"), {
        content,
        summary,
        turnIds,
        status: statusValue as ExplanationStatus | undefined,
      }),
    );
  });

  return router;
}
