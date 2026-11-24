import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import type { WorkspaceRepository } from "../repositories/workspace-repository.js";
import { HttpError } from "../http-error.js";
import { readBody, readOptionalString, readParam } from "./validation.js";
import { toHttpError } from "../services/ai/errors.js";
import { OpenAIProvider } from "../services/ai/openai-provider.js";
import { buildQuestionContext } from "../services/ai/question-context.js";
import { generateSolution } from "../services/ai/solution-generator.js";
import type { ProviderSettingsStore } from "../services/ai/provider-settings-store.js";
import type { PromptSettingsStore } from "../services/settings/prompt-settings-store.js";
import type { UiPreferencesStore } from "../services/settings/ui-preferences-store.js";
import type { AssetStore } from "../services/asset-store.js";

export function createSolutionRouter(
  repository: WorkspaceRepository,
  settingsStore: ProviderSettingsStore,
  assetStore: AssetStore,
  promptStore: PromptSettingsStore,
  uiStore: UiPreferencesStore,
): Router {
  const router = Router();

  router.post(
    "/questions/:id/solution/generate",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const questionId = readParam(req.params, "id");
        // 重新生成时可附带自由输入的补充要求（旧客户端不发送请求体）
        const body = readBody(req.body ?? {});
        const extraRequirement = readOptionalString(body, "extraRequirement", {
          max: 2000,
          label: "补充要求",
        });
        const apiKey = settingsStore.getApiKey();
        if (!apiKey) {
          throw new HttpError(400, "INVALID_CONFIG", "请先在模型设置中配置 API Key");
        }

        const config = settingsStore.getConfig();
        const provider = new OpenAIProvider(config, apiKey);
        // 图片附带策略为全局设置（默认按模型能力），不再读取每题的 image_policy 列
        const questionContext = repository.getQuestionContext(questionId);
        const context = buildQuestionContext({
          question: { ...questionContext, imagePolicy: uiStore.get().imagePolicy },
          provider: {
            supportsVision: config.supportsVision !== false,
            model: config.model,
          },
          store: assetStore,
          systemPrompt: promptStore.getSettings().solution_generation,
          enableMermaid: uiStore.get().enableMermaid,
          extraRequirement,
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
          const { drafts, usage } = await generateSolution(
            provider,
            context.messages,
            controller.signal,
          );
          settled = true;
          res.off("close", onClose);
          repository.recordAiRequest({
            taskType: "solution_generation",
            model: config.model,
            profileId: config.id,
            usage,
            ok: true,
          });
          res.status(201).json(repository.replaceSteps(questionId, drafts));
        } catch (error) {
          // settled 仍为 false 说明失败发生在上游调用阶段（区别于 replaceSteps 落库失败）
          if (!settled) {
            repository.recordAiRequest({
              taskType: "solution_generation",
              model: config.model,
              profileId: config.id,
              ok: false,
            });
          }
          throw error;
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
