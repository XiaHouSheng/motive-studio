import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import type { AIErrorCode, ChatStreamEvent, TokenUsage } from "@motive/shared";
import { encodeSseEvent } from "@motive/shared";
import type { WorkspaceRepository } from "../repositories/workspace-repository.js";
import { HttpError } from "../http-error.js";
import {
  readBody,
  readOptionalInteger,
  readOptionalString,
  readParam,
  readString,
} from "./validation.js";
import { CHAT_TEMPERATURE, buildChatMessages } from "../services/ai/context-builder.js";
import { AIError } from "../services/ai/errors.js";
import { OpenAIProvider } from "../services/ai/openai-provider.js";
import type { ProviderSettingsStore } from "../services/ai/provider-settings-store.js";

export function createStepsRouter(
  repository: WorkspaceRepository,
  settingsStore: ProviderSettingsStore,
): Router {
  const router = Router();

  router.get("/steps/:id/conversation", (req: Request, res: Response) => {
    res.json(repository.getConversationByStep(readParam(req.params, "id")));
  });

  router.post("/steps/:id/messages", (req: Request, res: Response) => {
    const body = readBody(req.body);
    const userMessage = readString(body, "userMessage", {
      max: 20_000,
      label: "用户消息",
    });
    const assistantMessage = readString(body, "assistantMessage", {
      max: 40_000,
      label: "助手回复",
    });
    res
      .status(201)
      .json(
        repository.appendTurn(readParam(req.params, "id"), userMessage, assistantMessage),
      );
  });

  router.post(
    "/steps/:id/messages/stream",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const stepId = readParam(req.params, "id");
        const body = readBody(req.body);
        const userMessage = readString(body, "userMessage", {
          max: 20_000,
          label: "用户消息",
        });

        const view = settingsStore.getView();
        const apiKey = settingsStore.getApiKey();
        if (!apiKey) {
          throw new HttpError(
            400,
            "INVALID_CONFIG",
            "请先在模型设置中配置 API Key",
          );
        }

        const context = repository.getChatContext(stepId);
        const messages = buildChatMessages(context, userMessage);
        const provider = new OpenAIProvider(view.provider, apiKey);

        res.status(200);
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();

        const sendEvent = (event: ChatStreamEvent) => {
          if (res.writableEnded || res.destroyed) return;
          try {
            res.write(encodeSseEvent(event));
          } catch {
            // 客户端已断开，忽略写入失败
          }
        };

        const controller = new AbortController();
        let settled = false;
        const onClose = () => {
          if (settled) return;
          settled = true;
          if (!res.writableEnded) controller.abort();
        };
        res.on("close", onClose);

        let text = "";
        let usage: TokenUsage | undefined;
        let finishReason: string | undefined;
        let failure: { code: AIErrorCode; message: string } | undefined;

        try {
          for await (const event of provider.streamChat(
            {
              messages,
              temperature: CHAT_TEMPERATURE,
              maxTokens: view.provider.maxTokens,
            },
            controller.signal,
          )) {
            if (event.type === "text-delta") {
              text += event.text;
              sendEvent(event);
              continue;
            }
            if (event.type === "usage") {
              if (
                event.inputTokens !== undefined ||
                event.outputTokens !== undefined
              ) {
                usage = {
                  inputTokens: event.inputTokens ?? usage?.inputTokens ?? 0,
                  outputTokens: event.outputTokens ?? usage?.outputTokens ?? 0,
                };
              }
              sendEvent(event);
              continue;
            }
            if (event.type === "completed") {
              finishReason = event.finishReason;
              break;
            }
            if (event.type === "error") {
              failure = { code: event.code, message: event.message };
              break;
            }
          }
        } catch (error) {
          if (error instanceof AIError) {
            if (error.code !== "CANCELLED") {
              failure = { code: error.code, message: error.message };
            }
          } else {
            failure = {
              code: "PROVIDER_ERROR",
              message: "生成回复时发生未知错误，请重试",
            };
          }
        }

        const cancelled = controller.signal.aborted;
        const generationStatus = cancelled || failure ? "interrupted" : "completed";

        let saveError: unknown;
        try {
          repository.appendTurn(stepId, userMessage, text, {
            generationStatus,
            chatUsage: usage,
          });
        } catch (error) {
          saveError = error;
        }

        settled = true;
        res.off("close", onClose);

        if (!cancelled) {
          if (failure) {
            sendEvent({ type: "error", code: failure.code, message: failure.message });
          } else if (saveError) {
            sendEvent({
              type: "error",
              code: "PROVIDER_ERROR",
              message: "回复已生成，但保存到本地失败",
            });
          } else {
            sendEvent({ type: "completed", finishReason });
          }
        }

        if (!res.writableEnded) res.end();
      } catch (error) {
        next(error);
      }
    },
  );

  router.patch("/steps/:id", (req: Request, res: Response) => {
    const body = readBody(req.body);
    const title = readOptionalString(body, "title", { max: 200, label: "步骤标题" });
    const content = readOptionalString(body, "content", {
      max: 40_000,
      label: "步骤内容",
    });
    const order = readOptionalInteger(body, "order", { label: "步骤序号" });

    if (title === undefined && content === undefined && order === undefined) {
      throw new HttpError(400, "INVALID_BODY", "没有需要更新的字段");
    }

    res.json(
      repository.updateStep(readParam(req.params, "id"), { title, content, order }),
    );
  });

  router.delete("/steps/:id", (req: Request, res: Response) => {
    repository.deleteStep(readParam(req.params, "id"));
    res.json({ ok: true });
  });

  return router;
}
