import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import type { WorkspaceRepository } from "../repositories/workspace-repository.js";
import { HttpError } from "../http-error.js";
import { readParam } from "./validation.js";
import { toHttpError } from "../services/ai/errors.js";
import { OpenAIProvider } from "../services/ai/openai-provider.js";
import { buildQuestionContext } from "../services/ai/question-context.js";
import { generateSolution } from "../services/ai/solution-generator.js";
import type { ProviderSettingsStore } from "../services/ai/provider-settings-store.js";
import type { AssetStore } from "../services/asset-store.js";

export function createSolutionRouter(
  repository: WorkspaceRepository,
  settingsStore: ProviderSettingsStore,
  assetStore: AssetStore,
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

        const config = settingsStore.getConfig();
        const provider = new OpenAIProvider(config, apiKey);
        const context = buildQuestionContext({
          question: repository.getQuestionContext(questionId),
          provider: {
            supportsVision: config.supportsVision !== false,
            model: config.model,
          },
          store: assetStore,
        });

        // 快照只用于追溯，写入失败不影响题解生成
        try {
          repository.recordContextSnapshot({
            questionId,
            taskType: "solution_generation",
            imagePolicy: context.imagePolicy,
            includedAssetIds: context.includedAssetIds,
            selectionReason: [...context.reasons, ...context.warnings].join(","),
            model: config.model,
          });
        } catch (snapshotError) {
          console.warn("[solution] 记录上下文快照失败", snapshotError);
        }

        const controller = new AbortController();
        let settled = false;
        const onClose = () => {
          if (settled) return;
          settled = true;
          if (!res.writableEnded) controller.abort();
        };
        res.on("close", onClose);

        try {
          const drafts = await generateSolution(provider, context.messages, controller.signal);
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
