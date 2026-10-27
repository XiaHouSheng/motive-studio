import { Router } from "express";
import type { Request, Response } from "express";
import type { ProviderTestResult } from "@motive/shared";
import { HttpError } from "../http-error.js";
import { readBody } from "./validation.js";
import { AIError, toHttpError } from "../services/ai/errors.js";
import { OpenAIProvider } from "../services/ai/openai-provider.js";
import type { ProviderSettingsStore } from "../services/ai/provider-settings-store.js";

const TEST_TIMEOUT_MS = 15_000;

export function createSettingsRouter(store: ProviderSettingsStore): Router {
  const router = Router();

  router.get("/settings/provider", (_req: Request, res: Response) => {
    res.json(store.getView());
  });

  router.put("/settings/provider", async (req: Request, res: Response) => {
    const body = readBody(req.body);
    const provider = readBody(body.provider);

    const apiKeyRaw = body.apiKey;
    if (apiKeyRaw !== undefined && typeof apiKeyRaw !== "string") {
      throw new HttpError(400, "INVALID_FIELD", "API Key 必须是字符串");
    }

    const clearApiKeyRaw = body.clearApiKey;
    if (clearApiKeyRaw !== undefined && typeof clearApiKeyRaw !== "boolean") {
      throw new HttpError(400, "INVALID_FIELD", "clearApiKey 必须是布尔值");
    }

    const apiKey =
      typeof apiKeyRaw === "string" && apiKeyRaw.trim().length > 0
        ? apiKeyRaw.trim()
        : undefined;

    res.json(
      await store.save({
        provider,
        apiKey,
        clearApiKey: clearApiKeyRaw === true,
      }),
    );
  });

  router.post("/settings/provider/test", async (_req: Request, res: Response) => {
    try {
      const view = store.getView();
      const apiKey = store.getApiKey();
      if (!apiKey) {
        throw new HttpError(400, "INVALID_CONFIG", "请先保存 API Key，再测试连接");
      }

      const provider = new OpenAIProvider(view.provider, apiKey);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
      const startedAt = Date.now();
      let received = false;

      try {
        for await (const event of provider.streamChat(
          {
            messages: [{ role: "user", content: "请只回复 OK" }],
            maxTokens: 16,
          },
          controller.signal,
        )) {
          if (event.type === "text-delta") received = true;
          if (event.type === "error") {
            throw new AIError(event.code, event.message);
          }
          if (event.type === "completed") break;
        }
      } catch (error) {
        if (controller.signal.aborted && !(error instanceof AIError)) {
          throw new AIError("NETWORK_ERROR", "连接测试超时，请检查 Base URL 与网络");
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }

      if (!received) {
        throw new AIError("INVALID_RESPONSE", "模型未返回有效内容，请检查模型名称");
      }

      const result: ProviderTestResult = {
        ok: true,
        model: view.provider.model,
        latencyMs: Date.now() - startedAt,
      };
      res.json(result);
    } catch (error) {
      throw toHttpError(error);
    }
  });

  return router;
}
