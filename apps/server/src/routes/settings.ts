import { Router } from "express";
import type { Request, Response } from "express";
import type { ProviderTestResult } from "@motive/shared";
import { HttpError } from "../http-error.js";
import { readBody, readParam } from "./validation.js";
import { isLocalRequest } from "./loopback.js";
import { AIError, toHttpError } from "../services/ai/errors.js";
import { OpenAIProvider } from "../services/ai/openai-provider.js";
import type { ProviderSettingsStore } from "../services/ai/provider-settings-store.js";
import type { PromptSettingsStore } from "../services/settings/prompt-settings-store.js";
import type { UiPreferencesStore } from "../services/settings/ui-preferences-store.js";
import type { RemoteAccessStore } from "../services/remote-access-store.js";
import { parseServerAddr } from "../services/remote-access-store.js";
import type { FrpcManager } from "../services/frpc-manager.js";

// 推理类模型（思考内容不算正文）首个正文可能较慢，放宽到 60 秒
const TEST_TIMEOUT_MS = 60_000;

export function createSettingsRouter(
  store: ProviderSettingsStore,
  promptStore: PromptSettingsStore,
  uiStore: UiPreferencesStore,
  remoteAccess: RemoteAccessStore,
  frpc?: FrpcManager,
): Router {
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

  // ---- 模型配置（profile）管理 ----

  router.get("/settings/provider/profiles", async (_req: Request, res: Response) => {
    res.json(await store.listProfiles());
  });

  // 把传入配置另存为新配置并激活；body 为 { name, provider, apiKey? }（apiKey 随新配置保存）
  router.post("/settings/provider/profiles", async (req: Request, res: Response) => {
    const body = readBody(req.body);
    if (typeof body.name !== "string") {
      throw new HttpError(400, "INVALID_FIELD", "配置名称必须是字符串");
    }
    if (body.apiKey !== undefined && typeof body.apiKey !== "string") {
      throw new HttpError(400, "INVALID_FIELD", "apiKey 必须是字符串");
    }
    res.json(
      await store.saveAsNewProfile(
        body.provider,
        body.name,
        typeof body.apiKey === "string" && body.apiKey.trim() ? body.apiKey.trim() : undefined,
      ),
    );
  });

  // ---- 讨论模型覆盖（chat 与题解/解析可分开配置） ----

  router.get("/settings/provider/chat-model", (_req: Request, res: Response) => {
    res.json({ profileId: store.getChatProfileId() });
  });

  router.put("/settings/provider/chat-model", (req: Request, res: Response) => {
    const body = readBody(req.body);
    if (body.profileId !== null && typeof body.profileId !== "string") {
      throw new HttpError(400, "INVALID_FIELD", "profileId 必须是字符串或 null");
    }
    const profileId =
      typeof body.profileId === "string" && body.profileId.trim()
        ? store.setChatProfileId(body.profileId.trim())
        : store.setChatProfileId(null);
    res.json({ profileId });
  });

  // 编辑指定配置（不改激活状态、不动其 Key，除非 clearApiKey=true 显式清除）
  router.put("/settings/provider/profiles/:id", async (req: Request, res: Response) => {
    const body = readBody(req.body);
    if (
      body.clearApiKey !== undefined &&
      typeof body.clearApiKey !== "boolean"
    ) {
      throw new HttpError(400, "INVALID_FIELD", "clearApiKey 必须是布尔值");
    }
    res.json(
      await store.updateProfile(readParam(req.params, "id"), body.provider, {
        clearApiKey: body.clearApiKey === true,
      }),
    );
  });

  // 显式清除指定配置的 API Key（沿用语义的反向操作）
  router.delete("/settings/provider/profiles/:id/key", async (req: Request, res: Response) => {
    res.json(await store.clearProfileKey(readParam(req.params, "id")));
  });

  router.post("/settings/provider/profiles/switch", async (req: Request, res: Response) => {
    const body = readBody(req.body);
    if (typeof body.profileId !== "string" || !body.profileId.trim()) {
      throw new HttpError(400, "INVALID_FIELD", "profileId 必须是非空字符串");
    }
    res.json(await store.switchProfile(body.profileId.trim()));
  });

  router.delete(
    "/settings/provider/profiles/:id",
    async (req: Request, res: Response) => {
      const profileId = readParam(req.params, "id");
      res.json(await store.deleteProfile(profileId));
    },
  );

  router.get("/settings/prompts", (_req: Request, res: Response) => {
    res.json(promptStore.getView());
  });

  // 请求体统一为 { "settings": { "<stage>": "..." } }；部分更新，未出现的 stage 保留原值
  router.put("/settings/prompts", (req: Request, res: Response) => {
    const body = readBody(req.body);
    const settings = body.settings;
    if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
      throw new HttpError(400, "INVALID_FIELD", "settings 必须是对象");
    }
    res.json(promptStore.save(settings as Record<string, unknown>));
  });

  router.get("/settings/ui", (_req: Request, res: Response) => {
    res.json(uiStore.get());
  });

  // 部分更新：只覆盖请求中明确提供的字段，成功后返回完整 UiPreferences
  router.put("/settings/ui", (req: Request, res: Response) => {
    const body = readBody(req.body);
    res.json(uiStore.save(body));
  });

  // ---- 远程接入 ----

  // 状态查看：完整密钥仅对本机回环返回（桌面端面板展示/复制用）
  router.get("/settings/remote-access", async (req: Request, res: Response) => {
    const view = await remoteAccess.getView();
    if (frpc) view.frpc = frpc.getStatus();
    if (!isLocalRequest(req)) {
      res.json(view);
      return;
    }
    const token = await remoteAccess.getToken();
    res.json({
      ...view,
      token,
      accessUrl: token && view.publicOrigin ? `${view.publicOrigin}/?t=${token}` : null,
    });
  });

  // 配置更新（启用开关 / 公网入口 / frps 地址）；已绑定的远程设备也可调用（远程关闭门卫的开关）。
  // 桌面版启用广播时联动内嵌 frpc：前置条件先整体校验，再落库，最后拉起进程。
  router.put("/settings/remote-access", async (req: Request, res: Response) => {
    const body = readBody(req.body);
    const config = remoteAccess.getConfig();
    const nextEnabled = typeof body.enabled === "boolean" ? body.enabled : config.enabled;
    const nextServerAddr = "serverAddr" in body ? parseServerAddr(body.serverAddr) : config.serverAddr;

    if (nextEnabled && frpc) {
      if (!frpc.getBinary()) {
        throw new HttpError(400, "INVALID_CONFIG", "未检测到 frpc 程序，无法开启广播");
      }
      if (!(await remoteAccess.getFrpsToken())) {
        throw new HttpError(400, "INVALID_CONFIG", "请先填写 frps 认证令牌");
      }
      if (!nextServerAddr) {
        throw new HttpError(400, "INVALID_CONFIG", "请先填写 frps 服务器地址");
      }
    }

    remoteAccess.saveConfig(body);

    // 首次开启广播时自动生成访问密钥，避免隧道已通而门卫未激活的裸奔窗口
    if (nextEnabled && !(await remoteAccess.getToken())) {
      await remoteAccess.rotateToken();
    }

    if (frpc) {
      if (nextEnabled) {
        const authToken = (await remoteAccess.getFrpsToken()) as string;
        frpc.start({ serverAddr: nextServerAddr, authToken });
      } else {
        frpc.stop();
      }
    }

    const view = await remoteAccess.getView();
    if (frpc) view.frpc = frpc.getStatus();
    res.json(view);
  });

  // frps 认证令牌（frpc 连接 frps 用，与访问密钥无关）：安全敏感，仅限桌面端本机设置
  router.post("/settings/remote-access/frps-token", async (req: Request, res: Response) => {
    if (!isLocalRequest(req)) {
      throw new HttpError(403, "UNAUTHORIZED", "frps 认证令牌仅允许在桌面端本机设置");
    }
    const body = readBody(req.body);
    if (typeof body.token !== "string" || !body.token.trim()) {
      throw new HttpError(400, "INVALID_FIELD", "token 必须是非空字符串");
    }
    await remoteAccess.setFrpsToken(body.token.trim());
    res.json(await remoteAccess.getView());
  });

  // 密钥轮换 / 吊销：安全敏感操作，仅限桌面端本机执行
  router.post("/settings/remote-access/rotate", async (req: Request, res: Response) => {
    if (!isLocalRequest(req)) {
      throw new HttpError(403, "UNAUTHORIZED", "密钥轮换仅允许在桌面端本机执行");
    }
    const token = await remoteAccess.rotateToken();
    const config = remoteAccess.getConfig();
    res.json({ token, accessUrl: config.publicOrigin ? `${config.publicOrigin}/?t=${token}` : null });
  });

  router.delete("/settings/remote-access/token", async (req: Request, res: Response) => {
    if (!isLocalRequest(req)) {
      throw new HttpError(403, "UNAUTHORIZED", "密钥吊销仅允许在桌面端本机执行");
    }
    await remoteAccess.clearToken();
    res.json({ ok: true });
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
      let finishReason: string | undefined;

      try {
        // 请求参数与实际生成路径保持一致：不强制 max_tokens。
        // 旧的 maxTokens: 16 会让推理类模型把预算耗在思考内容上（正文为空），
        // 而部分模型 API 也会直接拒绝该参数，均导致"实际可用但测试失败"。
        for await (const event of provider.streamChat(
          { messages: [{ role: "user", content: "请只回复 OK" }] },
          controller.signal,
        )) {
          if (event.type === "text-delta") {
            received = true;
            // 收到首个正文即可确认连通，主动中止剩余流
            controller.abort();
            break;
          }
          if (event.type === "completed") {
            finishReason = event.finishReason;
          }
          if (event.type === "error") {
            throw new AIError(event.code, event.message);
          }
        }
      } catch (error) {
        // 超时中止且未收到正文 → 明确的超时报错；收到正文后的主动中止 → 成功路径吞掉取消错误
        if (controller.signal.aborted && !received) {
          throw new AIError("NETWORK_ERROR", "连接测试超时：60 秒内未收到模型回复，请检查 Base URL 与网络");
        }
        if (!controller.signal.aborted) {
          throw error;
        }
      } finally {
        clearTimeout(timer);
      }

      if (!received) {
        const hint =
          finishReason && finishReason !== "stop"
            ? `（finish_reason: ${finishReason}）。推理类模型可能把 max tokens 耗在思考内容上，或该模型未输出正文`
            : "，请检查模型名称";
        throw new AIError("INVALID_RESPONSE", `模型未返回有效内容${hint}`);
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
