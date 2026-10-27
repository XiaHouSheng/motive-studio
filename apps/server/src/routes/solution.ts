import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import type { WorkspaceRepository } from "../repositories/workspace-repository.js";
import { HttpError } from "../http-error.js";
import { readParam } from "./validation.js";
import { toHttpError } from "../services/ai/errors.js";
import { OpenAIProvider } from "../services/ai/openai-provider.js";
import type { ProviderSettingsStore } from "../services/ai/provider-settings-store.js";
import { generateSolution } from "../services/ai/solution-generator.js";

export function createSolutionRouter(
  repository: WorkspaceRepository,
  settingsStore: ProviderSettingsStore,
): Router {
  const router = Router();

  router.post(
    "/questions/:id/solution/generate",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const questionId = readParam(req.params, "id");
        const apiKey = settingsStore.getApiKey();
        if (!apiKey) {
          throw new HttpError(400, "INVALID_CONFIG", "请先在模型设置中配置 API Key");
        }

        const question = repository.getQuestion(questionId);
        const provider = new OpenAIProvider(settingsStore.getConfig(), apiKey);

        const controller = new AbortController();
        let settled = false;
        const onClose = () => {
          if (settled) return;
          settled = true;
          if (!res.writableEnded) controller.abort();
        };
        res.on("close", onClose);

        try {
          const drafts = await generateSolution(
            provider,
            question.content,
            controller.signal,
          );
          settled = true;
          res.off("close", onClose);
          res.status(201).json(repository.replaceSteps(questionId, drafts));
        } finally {
          settled = true;
          res.off("close", onClose);
        }
      } catch (error) {
        if (error instanceof HttpError) {
          next(error);
        } else {
          next(toHttpError(error));
        }
      }
    },
  );

  router.get("/questions/:id/revisions", (req: Request, res: Response) => {
    res.json(repository.listRevisions(readParam(req.params, "id")));
  });

  router.post(
    "/questions/:id/revisions/:revisionId/restore",
    (req: Request, res: Response) => {
      const questionId = readParam(req.params, "id");
      const revision = repository.getRevision(
        questionId,
        readParam(req.params, "revisionId"),
      );
      res.json(repository.replaceSteps(questionId, revision.steps, "manual"));
    },
  );

  return router;
}
