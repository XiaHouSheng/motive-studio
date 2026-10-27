import express from "express";
import type { Request, Response } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { DB_FILE, UPLOADS_DIR, WEB_DIST, isProduction } from "./config.js";
import { openDatabase } from "./db/client.js";
import { errorHandler } from "./middleware/error-handler.js";
import { WorkspaceRepository } from "./repositories/workspace-repository.js";
import { ProviderSettingsStore } from "./services/ai/provider-settings-store.js";
import { createArchiveRouter } from "./routes/archive.js";
import { createBackupRouter } from "./routes/backup.js";
import { createBootstrapRouter } from "./routes/bootstrap.js";
import { createExplanationsRouter } from "./routes/explanations.js";
import { createExportRouter } from "./routes/exports.js";
import { healthRouter } from "./routes/health.js";
import { createImageImportRouter } from "./routes/image-import.js";
import { createMobileRouter } from "./routes/mobile.js";
import { createQuestionAssetsRouter } from "./routes/question-assets.js";
import { createQuestionGroupsRouter } from "./routes/question-groups.js";
import { createQuestionsRouter } from "./routes/questions.js";
import { createSettingsRouter } from "./routes/settings.js";
import { createSolutionRouter } from "./routes/solution.js";
import { createStepsRouter } from "./routes/steps.js";
import { AssetStore } from "./services/asset-store.js";
import { MobileSessionStore } from "./services/mobile-session.js";

export interface CreateAppOptions {
  dbPath?: string;
  uploadsDir?: string;
}

export function createApp(options: CreateAppOptions = {}) {
  const db = openDatabase(options.dbPath ?? DB_FILE);
  const repository = new WorkspaceRepository(db);
  const settingsStore = new ProviderSettingsStore(db);
  const mobileSessions = new MobileSessionStore();
  const assetStore = new AssetStore(options.uploadsDir ?? UPLOADS_DIR);

  const app = express();

  app.disable("x-powered-by");
  // 桌面端 4×6MB base64 ≈32MB，移动端 4×4MB ≈21.4MB，均需覆盖
  app.use(express.json({ limit: "40mb" }));

  app.use("/api/health", healthRouter);
  app.use("/api", createBootstrapRouter(repository));
  app.use("/api", createQuestionGroupsRouter(repository));
  app.use("/api", createImageImportRouter(repository, settingsStore));
  app.use("/api", createQuestionsRouter(repository));
  app.use("/api", createQuestionAssetsRouter(repository, assetStore));
  app.use("/api", createSolutionRouter(repository, settingsStore, assetStore));
  app.use("/api", createArchiveRouter(repository, settingsStore));
  app.use("/api", createStepsRouter(repository, settingsStore));
  app.use("/api", createExplanationsRouter(repository));
  app.use("/api", createExportRouter(repository));
  app.use("/api", createBackupRouter(repository));
  app.use("/api", createSettingsRouter(settingsStore));
  app.use(createMobileRouter(repository, settingsStore, mobileSessions, assetStore));

  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json({ code: "NOT_FOUND", message: "接口不存在" });
  });

  if (isProduction) {
    if (!existsSync(WEB_DIST)) {
      console.warn(`[server] 未找到前端构建产物：${WEB_DIST}`);
    }
    app.use(express.static(WEB_DIST, { index: false }));
    app.use((req: Request, res: Response) => {
      if (req.method !== "GET") return;
      const indexFile = path.join(WEB_DIST, "index.html");
      if (!existsSync(indexFile)) return;
      res.sendFile(indexFile);
    });
  }

  app.use(errorHandler);

  app.locals.db = db;
  app.locals.repository = repository;
  app.locals.settingsStore = settingsStore;

  return app;
}
