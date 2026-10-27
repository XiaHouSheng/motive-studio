import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import QRCode from "qrcode";
import { PORT } from "../config.js";
import { renderDeniedPage, renderMobilePage } from "../mobile/page.js";
import { HttpError } from "../http-error.js";
import type { WorkspaceRepository } from "../repositories/workspace-repository.js";
import { generateQuestionsFromImages } from "../services/ai/image-import-generator.js";
import { OpenAIProvider } from "../services/ai/openai-provider.js";
import { toHttpError } from "../services/ai/errors.js";
import type { ProviderSettingsStore } from "../services/ai/provider-settings-store.js";
import { getLanAddresses, isAllowedQrUrl } from "../services/lan.js";
import type { MobileSessionStore } from "../services/mobile-session.js";
import { readImages } from "./image-input.js";
import { readBody } from "./validation.js";

const MAX_QUESTIONS = 30;
const MAX_QUESTION_LENGTH = 40_000;

function isLoopbackRequest(req: Request): boolean {
  const address = req.socket.remoteAddress ?? "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

/** 二维码地址必须指向本服务实际监听的端口（测试环境使用随机端口） */
function resolvePort(req: Request): number {
  return req.socket.localPort ?? PORT;
}

function extractToken(req: Request): string {
  const header = req.header("x-mobile-token");
  if (header && header.trim()) return header.trim();
  const query = req.query.t;
  return typeof query === "string" ? query : "";
}

function requireToken(req: Request, sessions: MobileSessionStore): void {
  if (!sessions.validate(extractToken(req))) {
    throw new HttpError(403, "UNAUTHORIZED", "访问凭证无效或已过期，请重新扫码");
  }
}

function readQuestions(body: Record<string, unknown>): string[] {
  const raw = body.questions;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new HttpError(400, "INVALID_FIELD", "请至少提供一道题目");
  }
  if (raw.length > MAX_QUESTIONS) {
    throw new HttpError(400, "INVALID_FIELD", `单次最多导入 ${MAX_QUESTIONS} 道题目`);
  }
  return raw.map((item, index) => {
    if (typeof item !== "string" || !item.trim()) {
      throw new HttpError(400, "INVALID_FIELD", `第 ${index + 1} 道题目内容不能为空`);
    }
    const content = item.trim();
    if (content.length > MAX_QUESTION_LENGTH) {
      throw new HttpError(400, "INVALID_FIELD", `第 ${index + 1} 道题目内容不能超过 ${MAX_QUESTION_LENGTH} 个字符`);
    }
    return content;
  });
}

function readCommitTarget(body: Record<string, unknown>): { groupId: string } | { groupTitle?: string } {
  const raw = body.target;
  if (typeof raw !== "object" || raw === null) {
    throw new HttpError(400, "INVALID_FIELD", "target 格式不正确");
  }
  const target = raw as { type?: unknown; groupId?: unknown; title?: unknown };
  if (target.type === "existing") {
    if (typeof target.groupId !== "string" || !target.groupId.trim()) {
      throw new HttpError(400, "INVALID_FIELD", "缺少目标题组 id");
    }
    return { groupId: target.groupId.trim() };
  }
  if (target.type === "new") {
    if (target.title !== undefined && typeof target.title !== "string") {
      throw new HttpError(400, "INVALID_FIELD", "题组名称必须是字符串");
    }
    const title = typeof target.title === "string" ? target.title.trim() : "";
    if (title.length > 100) {
      throw new HttpError(400, "INVALID_FIELD", "题组名称不能超过 100 个字符");
    }
    return title ? { groupTitle: title } : {};
  }
  throw new HttpError(400, "INVALID_FIELD", "target.type 必须是 existing 或 new");
}

export function createMobileRouter(
  repository: WorkspaceRepository,
  settingsStore: ProviderSettingsStore,
  sessions: MobileSessionStore,
): Router {
  const router = Router();

  // 桌面端注册凭证（key 由桌面端生成，仅允许本机回环调用）
  router.post("/api/mobile/link", (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!isLoopbackRequest(req)) {
        throw new HttpError(403, "UNAUTHORIZED", "仅允许在桌面端本机注册访问凭证");
      }
      const body = readBody(req.body);
      const token = sessions.register(body.key);
      const urls = getLanAddresses(resolvePort(req)).map((origin) => `${origin}/m?t=${token}`);
      res.json({ token, urls, preferred: urls[0] ?? null });
    } catch (error) {
      next(error instanceof HttpError ? error : toHttpError(error));
    }
  });

  // 二维码生成（仅允许本机回环调用，且目标必须是本机地址）
  router.get("/api/mobile/qr.svg", (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!isLoopbackRequest(req)) {
        throw new HttpError(403, "UNAUTHORIZED", "仅允许在桌面端本机生成二维码");
      }
      const rawUrl = req.query.url;
      if (typeof rawUrl !== "string" || !isAllowedQrUrl(rawUrl, resolvePort(req))) {
        throw new HttpError(400, "INVALID_PARAM", "二维码地址必须是本机地址");
      }
      QRCode.toString(rawUrl, { type: "svg", margin: 1 })
        .then((svg) => {
          res.setHeader("Content-Type", "image/svg+xml");
          res.setHeader("Cache-Control", "no-store");
          res.send(svg);
        })
        .catch(next);
    } catch (error) {
      next(error instanceof HttpError ? error : toHttpError(error));
    }
  });

  // 手机页：query t 为访问凭证
  router.get("/m", (req: Request, res: Response) => {
    const token = typeof req.query.t === "string" ? req.query.t : "";
    if (!sessions.validate(token)) {
      res.status(403).type("html").send(renderDeniedPage());
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.type("html").send(renderMobilePage());
  });

  router.get(
    "/api/mobile/groups",
    (req: Request, res: Response, next: NextFunction) => {
      try {
        requireToken(req, sessions);
        res.json({ groups: repository.listGroupSummaries() });
      } catch (error) {
        next(error instanceof HttpError ? error : toHttpError(error));
      }
    },
  );

  router.post(
    "/api/mobile/extract",
    (req: Request, res: Response, next: NextFunction) => {
      try {
        requireToken(req, sessions);
        const images = readImages(readBody(req.body));

        const apiKey = settingsStore.getApiKey();
        if (!apiKey) {
          throw new HttpError(400, "INVALID_CONFIG", "请先在桌面端模型设置中配置 API Key");
        }

        const provider = new OpenAIProvider(settingsStore.getConfig(), apiKey);
        generateQuestionsFromImages(provider, images)
          .then((questions) => res.json({ questions }))
          .catch(next);
      } catch (error) {
        next(error instanceof HttpError ? error : toHttpError(error));
      }
    },
  );

  router.post(
    "/api/mobile/commit",
    (req: Request, res: Response, next: NextFunction) => {
      try {
        requireToken(req, sessions);
        const body = readBody(req.body);
        const target = readCommitTarget(body);
        const questions = readQuestions(body);
        const result = repository.importQuestions(target, questions);
        res.json(result);
      } catch (error) {
        next(error instanceof HttpError ? error : toHttpError(error));
      }
    },
  );

  return router;
}
