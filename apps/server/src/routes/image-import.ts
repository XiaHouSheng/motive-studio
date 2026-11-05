import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { HttpError } from "../http-error.js";
import type { WorkspaceRepository } from "../repositories/workspace-repository.js";
import { OpenAIProvider } from "../services/ai/openai-provider.js";
import { generateQuestionsFromImages } from "../services/ai/image-import-generator.js";
import { toHttpError } from "../services/ai/errors.js";
import type { ProviderSettingsStore } from "../services/ai/provider-settings-store.js";
import type { PromptSettingsStore } from "../services/settings/prompt-settings-store.js";
import { readExtraPrompt, readImages } from "./image-input.js";
import { readBody, readParam } from "./validation.js";

export function createImageImportRouter(
  repository: WorkspaceRepository,
  settingsStore: ProviderSettingsStore,
  promptStore: PromptSettingsStore,
): Router {
  const router = Router();

  router.post(
    "/question-groups/:id/image-import",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const groupId = readParam(req.params, "id");
        repository.getGroupTitle(groupId);
        const body = readBody(req.body);
        const images = readImages(body);
        const extraPrompt = readExtraPrompt(body);

        const apiKey = settingsStore.getApiKey();
        if (!apiKey) {
          throw new HttpError(400, "INVALID_CONFIG", "请先在模型设置中配置 API Key");
        }

        const provider = new OpenAIProvider(settingsStore.getConfig(), apiKey);
        // 与手机拍照导入（routes/mobile.ts）使用相同的环节提示词配置
        const questions = await generateQuestionsFromImages(provider, images, undefined, {
          systemPrompt: promptStore.getSettings().image_import,
          extraPrompt,
        });
        res.json({ questions });
      } catch (error) {
        if (error instanceof HttpError) {
          next(error);
        } else {
          next(toHttpError(error));
        }
      }
    },
  );

  return router;
}
