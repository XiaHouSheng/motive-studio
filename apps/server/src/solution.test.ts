import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type {
  ProviderSettingsView,
  SolutionGenerationResult,
  SolutionRevision,
  WorkspaceData,
} from "@motive/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const SEED_STEP_ID = "s-quad-1";

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

async function startUpstream(
  respond: (attempt: number) => string,
): Promise<RunningUpstream> {
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
      writeSolutionStream(res, respond(record.bodies.length));
    });
  });

  server.listen(0, "127.0.0.1");
  const port = await listen(server);
  record.baseUrl = `http://127.0.0.1:${port}/v1`;
  return record;
}

function writeSolutionStream(res: ServerResponse, payload: string) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
  });
  res.write(
    `data: ${JSON.stringify({ choices: [{ delta: { content: payload } }] })}\n\n`,
  );
  res.write(
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":30,"completion_tokens":20}}\n\n',
  );
  res.write("data: [DONE]\n\n");
  res.end();
}

async function configureProvider(
  app: RunningApp,
  upstream: RunningUpstream,
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
      },
      apiKey: "sk-test-solution",
    }),
  });
  expect(response.status).toBe(200);
  expect(((await response.json()) as ProviderSettingsView).hasApiKey).toBe(true);
}

async function bootstrap(app: RunningApp): Promise<WorkspaceData> {
  const response = await fetch(`${app.baseUrl}/api/bootstrap`);
  return (await response.json()) as WorkspaceData;
}

async function seededQuestion(app: RunningApp) {
  const data = await bootstrap(app);
  const question = data.questions.find((item) =>
    item.solutionStepIds.includes(SEED_STEP_ID),
  );
  if (!question) throw new Error("未找到种子题目");
  return question;
}

async function generate(app: RunningApp, questionId: string): Promise<Response> {
  return fetch(
    `${app.baseUrl}/api/questions/${encodeURIComponent(questionId)}/solution/generate`,
    { method: "POST" },
  );
}

let workDir: string;
let apps: RunningApp[] = [];
let upstreams: RunningUpstream[] = [];

beforeEach(() => {
  workDir = mkdtempSync(path.join(tmpdir(), "motive-solution-"));
  apps = [];
  upstreams = [];
});

afterEach(async () => {
  for (const app of apps) await app.close();
  for (const upstream of upstreams) await upstream.close();
  rmSync(workDir, { recursive: true, force: true });
});

async function setup(respond: (attempt: number) => string) {
  const app = await startApp(path.join(workDir, "test.db"));
  apps.push(app);
  const upstream = await startUpstream(respond);
  upstreams.push(upstream);
  await configureProvider(app, upstream);
  return { app, upstream };
}

const VALID_SOLUTION = JSON.stringify({
  steps: [
    { title: "第一步", content: "先配方" },
    { title: "第二步", content: "再求根" },
    { title: "第三步", content: "最后检验" },
  ],
});

describe("正式题解生成", () => {
  it("生成成功时覆盖旧步骤并保存版本", async () => {
    const { app, upstream } = await setup(() => VALID_SOLUTION);
    const question = await seededQuestion(app);
    const oldStepIds = question.solutionStepIds;

    const response = await generate(app, question.id);
    expect(response.status).toBe(201);
    const result = (await response.json()) as SolutionGenerationResult;

    expect(result.steps.map((step) => step.title)).toEqual([
      "第一步",
      "第二步",
      "第三步",
    ]);
    expect(result.steps.map((step) => step.order)).toEqual([1, 2, 3]);
    expect(result.revision.revisionNumber).toBe(1);
    expect(result.revision.createdBy).toBe("ai");
    expect(result.revision.steps).toHaveLength(3);

    const body = upstream.bodies[0] as {
      model: string;
      temperature: number;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe("test-model");
    expect(body.temperature).toBe(0.2);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain("只输出 JSON");
    expect(body.messages[1].content).toContain("已知函数");

    const after = await bootstrap(app);
    const updated = after.questions.find((item) => item.id === question.id);
    expect(updated?.solutionStepIds).toEqual(result.steps.map((step) => step.id));
    for (const oldId of oldStepIds) {
      expect(after.steps.some((step) => step.id === oldId)).toBe(false);
      expect(after.subs.some((sub) => sub.entryStepId === oldId)).toBe(false);
    }

    const revisionsResponse = await fetch(
      `${app.baseUrl}/api/questions/${encodeURIComponent(question.id)}/revisions`,
    );
    expect(revisionsResponse.status).toBe(200);
    const revisions = (await revisionsResponse.json()) as SolutionRevision[];
    expect(revisions).toHaveLength(1);
    expect(revisions[0].steps.map((step) => step.title)).toEqual([
      "第一步",
      "第二步",
      "第三步",
    ]);
  });

  it("首次返回非法 JSON 时重试一次并成功", async () => {
    const { app, upstream } = await setup((attempt) =>
      attempt === 1 ? "这不是 JSON" : VALID_SOLUTION,
    );
    const question = await seededQuestion(app);

    const response = await generate(app, question.id);
    expect(response.status).toBe(201);
    const result = (await response.json()) as SolutionGenerationResult;
    expect(result.steps).toHaveLength(3);
    expect(upstream.bodies).toHaveLength(2);
  });

  it("两次都非法时不改动现有步骤", async () => {
    const { app, upstream } = await setup(() => "始终不是 JSON");
    const question = await seededQuestion(app);
    const before = question.solutionStepIds;

    const response = await generate(app, question.id);
    expect(response.status).toBe(502);
    expect(((await response.json()) as { code: string }).code).toBe(
      "INVALID_RESPONSE",
    );
    expect(upstream.bodies).toHaveLength(2);

    const after = await bootstrap(app);
    const updated = after.questions.find((item) => item.id === question.id);
    expect(updated?.solutionStepIds).toEqual(before);
  });

  it("未配置 API Key 时返回 400", async () => {
    const app = await startApp(path.join(workDir, "nokey.db"));
    apps.push(app);
    const question = await seededQuestion(app);

    const response = await generate(app, question.id);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe(
      "INVALID_CONFIG",
    );
  });
});
