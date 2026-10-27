import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import type { ArchiveProposalDraft } from "@motive/shared";
import type {
  ArchiveContextData,
  WorkspaceRepository,
} from "../repositories/workspace-repository.js";
import { HttpError } from "../http-error.js";
import { readParam } from "./validation.js";
import { AIError, toHttpError } from "../services/ai/errors.js";
import { generateArchiveProposal } from "../services/ai/archive-generator.js";
import { OpenAIProvider } from "../services/ai/openai-provider.js";
import type { ProviderSettingsStore } from "../services/ai/provider-settings-store.js";

function assertReferences(
  context: ArchiveContextData,
  draft: ArchiveProposalDraft,
): void {
  const stepIds = new Set(context.steps.map((step) => step.id));
  const turnIds = new Set(context.turns.map((turn) => turn.id));

  for (const change of draft.changes) {
    if (!stepIds.has(change.stepId)) {
      throw new AIError("INVALID_RESPONSE", "提案引用了不存在的步骤");
    }
    for (const turnId of change.sourceTurnIds) {
      if (!turnIds.has(turnId)) {
        throw new AIError("INVALID_RESPONSE", "提案引用了不存在的讨论轮次");
      }
    }
  }
}

export function createArchiveRouter(
  repository: WorkspaceRepository,
  settingsStore: ProviderSettingsStore,
): Router {
  const router = Router();

  router.post(
    "/discussions/:id/archive",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const subConversationId = readParam(req.params, "id");
        const apiKey = settingsStore.getApiKey();
        if (!apiKey) {
          throw new HttpError(
            400,
            "INVALID_CONFIG",
            "请先在模型设置中配置 API Key",
          );
        }

        const context = repository.getArchiveContext(subConversationId);
        if (context.turns.length === 0) {
          throw new HttpError(
            400,
            "EMPTY_DISCUSSION",
            "该讨论还没有可用于归档的内容",
          );
        }

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
          const draft = await generateArchiveProposal(
            provider,
            context,
            controller.signal,
          );
          assertReferences(context, draft);

          const sourceTurnIds = [
            ...new Set(draft.changes.flatMap((change) => change.sourceTurnIds)),
          ];

          settled = true;
          res.off("close", onClose);
          res.status(201).json(
            repository.createArchiveProposal({
              subConversationId,
              questionId: context.question.id,
              summary: draft.summary,
              changes: draft.changes,
              sourceTurnIds,
            }),
          );
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

  router.get("/questions/:id/archive-proposals", (req: Request, res: Response) => {
    res.json(repository.listArchiveProposals(readParam(req.params, "id")));
  });

  router.post("/archive-proposals/:id/apply", (req: Request, res: Response) => {
    res.json(repository.applyArchiveProposal(readParam(req.params, "id")));
  });

  router.post("/archive-proposals/:id/reject", (req: Request, res: Response) => {
    res.json(repository.rejectArchiveProposal(readParam(req.params, "id")));
  });

  return router;
}
