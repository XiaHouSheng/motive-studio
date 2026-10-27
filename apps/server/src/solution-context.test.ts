import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Question, QuestionAsset, WorkspaceData } from "@motive/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const GROUP_ID = "g-math";
const IMAGE = {
  mediaType: "image/png",
  data: Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([1]),
  ]).toString("base64"),
};

const VALID_SOLUTION = JSON.stringify({
  steps: [
    { title: "第一步", content: "先配方" },
    { title: "第二步", content: "再求根" },
  ],
});

interface RunningApp {
  baseUrl: string;
  db: DatabaseSync;
  close: () => Promise<void>;
}

interface RunningUpstream {
  baseUrl: string;
  bodies: Array<Record<string, unknown>>;
  close: () => Promise<void>;
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("未获得端口");
  return address.port;
}

async function startApp(dbPath: string): Promise<RunningApp> {
  const app = createApp({ dbPath, uploadsDir: path.join(path.dirname(dbPath), "uploads") });
  const server = app.listen(0, "127.0.0.1");
  const port = await listen(server);
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    db: app.locals.db as DatabaseSync,
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      (app.locals.db as DatabaseSync).close();
    },
  };
}

function writeStream(res: ServerResponse, payload: string) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
  });
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: payload } }] })}\n\n`);
  res.write(
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":30,"completion_tokens":20}}\n\n',
  );
  res.write("data: [DONE]\n\n");
  res.end();
}

async function startUpstream(): Promise<RunningUpstream> {
  const record: RunningUpstream = {
    baseUrl: "",
    bodies: [],
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += String(chunk);
    });
    req.on("end", () => {
      try {
        record.bodies.push(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        record.bodies.push({});
      }
      writeStream(res, VALID_SOLUTION);
    });
  });
  server.listen(0, "127.0.0.1");
  const port = await listen(server);
  record.baseUrl = `http://127.0.0.1:${port}/v1`;
  return record;
}

async function configureProvider(
  app: RunningApp,
  upstream: RunningUpstream,
  supportsVision: boolean,
): Promise<void> {
  const response = await fetch(`${app.baseUrl}/api/settings/provider`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: {
        id: "default",
        name: "Test Provider",
        baseUrl: upstream.baseUrl,
        model: "test-model",
        protocol: "openai-chat-completions",
        supportsVision,
      },
      apiKey: "sk-test-context",
    }),
  });
  expect(response.status).toBe(200);
}

async function createQuestionWithImage(app: RunningApp): Promise<Question> {
  const created = await fetch(`${app.baseUrl}/api/questions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ groupId: GROUP_ID, content: "已知函数 $f(x)=x^2-6x+5$。" }),
  });
  expect(created.status).toBe(201);
  const question = (await created.json()) as Question;

  const upload = await fetch(`${app.baseUrl}/api/questions/${question.id}/assets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ images: [IMAGE] }),
  });
  expect(upload.status).toBe(201);
  const assets = ((await upload.json()) as { assets: QuestionAsset[] }).assets;
  expect(assets).toHaveLength(1);
  return question;
}

async function setPolicy(app: RunningApp, questionId: string, imagePolicy: string): Promise<void> {
  const response = await fetch(`${app.baseUrl}/api/questions/${questionId}/image-policy`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imagePolicy }),
  });
  expect(response.status).toBe(200);
}

function generate(app: RunningApp, questionId: string): Promise<Response> {
  return fetch(`${app.baseUrl}/api/questions/${questionId}/solution/generate`, {
    method: "POST",
  });
}

function lastSnapshot(app: RunningApp): {
  image_policy: string;
  included_asset_ids: string;
  selection_reason: string;
} {
  return app.db
    .prepare(
      `SELECT image_policy, included_asset_ids, selection_reason
       FROM ai_context_snapshots ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .get() as {
    image_policy: string;
    included_asset_ids: string;
    selection_reason: string;
  };
}

function imageParts(body: Record<string, unknown>): unknown[] {
  const messages = body.messages as Array<{ role: string; content: unknown }>;
  const user = messages.find((message) => message.role === "user");
  if (!Array.isArray(user?.content)) return [];
  return (user.content as Array<Record<string, unknown>>).filter(
    (part) => part.type === "image_url",
  );
}

describe("题解上下文构建", () => {
  let dir: string;
  let app: RunningApp;
  let upstream: RunningUpstream;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "motive-context-"));
    app = await startApp(path.join(dir, "motive.db"));
    upstream = await startUpstream();
  });

  afterEach(async () => {
    await app.close();
    await upstream.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("never 策略不发送图片，快照记录原图未使用", async () => {
    await configureProvider(app, upstream, true);
    const question = await createQuestionWithImage(app);
    await setPolicy(app, question.id, "never");

    const response = await generate(app, question.id);
    expect(response.status).toBe(201);

    expect(imageParts(upstream.bodies[0])).toHaveLength(0);
    const snapshot = lastSnapshot(app);
    expect(snapshot.image_policy).toBe("never");
    expect(snapshot.included_asset_ids).toBe("[]");
    expect(snapshot.selection_reason).toContain("policy_never");
  });

  it("always 且有视觉能力时以 data URL 附带原图", async () => {
    await configureProvider(app, upstream, true);
    const question = await createQuestionWithImage(app);
    await setPolicy(app, question.id, "always");

    const response = await generate(app, question.id);
    expect(response.status).toBe(201);

    const parts = imageParts(upstream.bodies[0]);
    expect(parts).toHaveLength(1);
    expect(JSON.stringify(parts)).toContain(`data:image/png;base64,${IMAGE.data}`);

    const snapshot = lastSnapshot(app);
    expect(snapshot.image_policy).toBe("always");
    expect(JSON.parse(snapshot.included_asset_ids)).toHaveLength(1);
    expect(snapshot.selection_reason).toContain("policy_always");
  });

  it("always 且无视觉能力时明确报错", async () => {
    await configureProvider(app, upstream, false);
    const question = await createQuestionWithImage(app);
    await setPolicy(app, question.id, "always");

    const response = await generate(app, question.id);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe("VISION_UNSUPPORTED");
    expect(upstream.bodies).toHaveLength(0);
  });

  it("auto 且无视觉能力时降级为纯文本并记录原因", async () => {
    await configureProvider(app, upstream, false);
    const question = await createQuestionWithImage(app);

    const response = await generate(app, question.id);
    expect(response.status).toBe(201);

    expect(imageParts(upstream.bodies[0])).toHaveLength(0);
    const snapshot = lastSnapshot(app);
    expect(snapshot.image_policy).toBe("auto");
    expect(snapshot.included_asset_ids).toBe("[]");
    expect(snapshot.selection_reason).toContain("vision_unsupported_fallback");
  });

  it("bootstrap 中题目带图片策略与原图列表", async () => {
    await configureProvider(app, upstream, true);
    const question = await createQuestionWithImage(app);

    const workspace = (await (
      await fetch(`${app.baseUrl}/api/bootstrap`)
    ).json()) as WorkspaceData;
    const reloaded = workspace.questions.find((item) => item.id === question.id);
    expect(reloaded?.imagePolicy).toBe("auto");
    expect(reloaded?.assets[0]?.url).toBe(`/api/assets/${reloaded?.assets[0]?.id}`);
  });
});
