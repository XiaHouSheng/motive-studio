import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import type { WorkspaceRepository } from "../repositories/workspace-repository.js";
import { HttpError } from "../http-error.js";
import { readParam } from "./validation.js";
import { toHttpError } from "../services/ai/errors.js";
import { OpenAIProvider } from "../services/ai/openai-provider.js";
import { buildExplanationMessages } from "../services/ai/explanation-context-builder.js";
import { generateExplanation } from "../services/ai/explanation-generator.js";
import type { ProviderSettingsStore } from "../services/ai/provider-settings-store.js";

export function createExplanationsRouter(
  repository: WorkspaceRepository,
  settingsStore: ProviderSettingsStore,
): Router {
  const router = Router();

  router.post(
    "/questions/:id/explanations/generate",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const questionId = readParam(req.params, "id");
        const apiKey = settingsStore.getApiKey();
        if (!apiKey) {
          throw new HttpError(400, "INVALID_CONFIG", "请先在模型设置中配置 API Key");
        }

        const context = repository.getExplanationContext(questionId);
        if (context.steps.length === 0) {
          throw new HttpError(400, "NO_STEPS", "请先生成分步题解，再生成详解");
        }
        if (context.turns.length === 0) {
          throw new HttpError(
            400,
            "NO_DISCUSSION",
            "没有可纳入的讨论：先在步骤讨论中提问，再生成详解",
          );
        }

        const config = settingsStore.getConfig();
        const provider = new OpenAIProvider(config, apiKey);
        const messages = buildExplanationMessages(context);

        const controller = new AbortController();
        let settled = false;
        const onClose = () => {
          if (settled) return;
          settled = true;
          if (!res.writableEnded) controller.abort();
        };
        res.on("close", onClose);

        try {
          const draft = await generateExplanation(provider, messages, controller.signal);
          settled = true;
          res.off("close", onClose);
          const turnIds = context.turns.map((turn) => turn.id);
          const explanation = repository.createExplanation(questionId, {
            content: draft.content,
            summary: draft.summary,
            turnIds,
            usage: draft.usage,
          });
          repository.markTurnsArchived(turnIds);
          res.status(201).json(explanation);
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

  router.delete("/explanations/:id", (req: Request, res: Response) => {
    repository.deleteExplanation(readParam(req.params, "id"));
    res.json({ ok: true });
  });

  return router;
}
