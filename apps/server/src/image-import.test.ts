import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { ProviderSettingsView, WorkspaceData } from "@motive/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const GROUP_ID = "g-math";
const IMAGE = { mediaType: "image/png", data: "iVBORw0KGgo=" };

interface RunningApp {
  baseUrl: string;
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
  const app = createApp({ dbPath });
  const server = app.listen(0, "127.0.0.1");
  const port = await listen(server);

  let closed = false;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      (app.locals.db as DatabaseSync).close();
    },
  };
}

async function startUpstream(respond: (attempt: number) => string): Promise<RunningUpstream> {
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
      let body: Record<string, unknown> | undefined;
      try {
        body = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        body = undefined;
      }
      if (body) record.bodies.push(body);
      writeStream(res, respond(record.bodies.length));
    });
  });

  server.listen(0, "127.0.0.1");
  const port = await listen(server);
  record.baseUrl = `http://127.0.0.1:${port}/v1`;
  return record;
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

async function configureProvider(app: RunningApp, upstream: RunningUpstream): Promise<void> {
  const response = await fetch(`${app.baseUrl}/api/settings/provider`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: {
        id: "default",
        name: "Test Provider",
        baseUrl: upstream.baseUrl,
        model: "test-vision-model",
        protocol: "openai-chat-completions",
      },
      apiKey: "sk-test-vision",
    }),
  });
  expect(response.status).toBe(200);
  expect(((await response.json()) as ProviderSettingsView).hasApiKey).toBe(true);
}

function importImages(
  app: RunningApp,
  body: unknown,
  groupId: string = GROUP_ID,
): Promise<Response> {
  return fetch(`${app.baseUrl}/api/question-groups/${groupId}/image-import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function bootstrap(app: RunningApp): Promise<WorkspaceData> {
  const response = await fetch(`${app.baseUrl}/api/bootstrap`);
  return (await response.json()) as WorkspaceData;
}

describe("题组按图片导入", () => {
  let dir: string;
  let app: RunningApp;
  let upstream: RunningUpstream | undefined;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "motive-image-import-"));
    app = await startApp(path.join(dir, "motive.db"));
    upstream = undefined;
  });

  afterEach(async () => {
    await app.close();
    if (upstream) await upstream.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("识别图片中的题目并将图片以 data URL 发送给模型", async () => {
    upstream = await startUpstream(() =>
      JSON.stringify({
        questions: ["已知函数 $f(x)=x^{2}-6x+5$，求最小值。", "证明 $\\sqrt{2}$ 是无理数。"],
      }),
    );
    await configureProvider(app, upstream);
    const before = await bootstrap(app);

    const response = await importImages(app, { images: [IMAGE] });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      questions: ["已知函数 $f(x)=x^{2}-6x+5$，求最小值。", "证明 $\\sqrt{2}$ 是无理数。"],
    });

    expect(upstream.bodies).toHaveLength(1);
    const body = upstream.bodies[0];
    expect(body.temperature).toBe(0.1);
    const messages = body.messages as Array<{ role: string; content: unknown }>;
    expect(messages[0].role).toBe("system");
    const parts = messages[1].content as Array<Record<string, unknown>>;
    expect(parts.some((part) => part.type === "image_url")).toBe(true);
    expect(
      JSON.stringify(parts).includes("data:image/png;base64,iVBORw0KGgo="),
    ).toBe(true);

    // 预览阶段不写库
    const workspace = await bootstrap(app);
    expect(workspace.questions).toHaveLength(before.questions.length);
    expect(
      workspace.questions.filter((question) => question.groupId === GROUP_ID),
    ).toHaveLength(
      before.questions.filter((question) => question.groupId === GROUP_ID).length,
    );
  });

  it("未识别到题目时返回空数组", async () => {
    upstream = await startUpstream(() => JSON.stringify({ questions: [] }));
    await configureProvider(app, upstream);

    const response = await importImages(app, { images: [IMAGE] });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ questions: [] });
  });

  it("未配置 API Key 时返回 400", async () => {
    const response = await importImages(app, { images: [IMAGE] });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("INVALID_CONFIG");
  });

  it("题组不存在时返回 404", async () => {
    upstream = await startUpstream(() => JSON.stringify({ questions: [] }));
    await configureProvider(app, upstream);

    const response = await importImages(app, { images: [IMAGE] }, "g-missing");
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("NOT_FOUND");
  });

  it("校验图片数量、格式与数据", async () => {
    upstream = await startUpstream(() => JSON.stringify({ questions: [] }));
    await configureProvider(app, upstream);

    const empty = await importImages(app, { images: [] });
    expect(empty.status).toBe(400);
    expect((await empty.json()).code).toBe("INVALID_FIELD");

    const wrongType = await importImages(app, {
      images: [{ mediaType: "image/gif", data: IMAGE.data }],
    });
    expect(wrongType.status).toBe(400);

    const tooMany = await importImages(app, {
      images: Array.from({ length: 5 }, () => IMAGE),
    });
    expect(tooMany.status).toBe(400);

    expect(upstream.bodies).toHaveLength(0);
  });

  it("模型连续返回无效结果时返回 502 且不写库", async () => {
    upstream = await startUpstream(() => "不是 JSON");
    await configureProvider(app, upstream);

    const before = await bootstrap(app);
    const response = await importImages(app, { images: [IMAGE] });
    expect(response.status).toBe(502);
    expect((await response.json()).code).toBe("INVALID_RESPONSE");
    expect(upstream.bodies).toHaveLength(2);

    const after = await bootstrap(app);
    expect(after.questions).toHaveLength(before.questions.length);
  });
});
