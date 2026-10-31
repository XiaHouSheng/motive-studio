import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type {
  ProviderSettingsView,
  SolutionExplanation,
  WorkspaceData,
} from "@motive/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const QUESTION_ID = "q-quad";
const UNARCHIVED_TURNS = ["t-1", "t-2", "t-3"];

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
  const app = createApp({ dbPath, uploadsDir: path.join(path.dirname(dbPath), "uploads") });
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
      writeStream(res, respond(record.bodies.length));
    });
  });

  server.listen(0, "127.0.0.1");
  const port = await listen(server);
  record.baseUrl = `http://127.0.0.1:${port}/v1`;
  return record;
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
        model: "test-model",
        protocol: "openai-chat-completions",
      },
      apiKey: "sk-test-explanation",
    }),
  });
  expect(response.status).toBe(200);
  expect(((await response.json()) as ProviderSettingsView).hasApiKey).toBe(true);
}

async function bootstrap(app: RunningApp): Promise<WorkspaceData> {
  const response = await fetch(`${app.baseUrl}/api/bootstrap`);
  return (await response.json()) as WorkspaceData;
}

async function generate(app: RunningApp, questionId: string): Promise<Response> {
  return fetch(
    `${app.baseUrl}/api/questions/${encodeURIComponent(questionId)}/explanations/generate`,
    { method: "POST" },
  );
}

let workDir: string;
let apps: RunningApp[] = [];
let upstreams: RunningUpstream[] = [];

beforeEach(() => {
  workDir = mkdtempSync(path.join(tmpdir(), "motive-explanation-"));
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

const VALID_EXPLANATION = JSON.stringify({
  explanation:
    "## 配方与最值\n本题先把二次式配方，再比较驻点与端点。特别是闭区间最值，必须同时检查端点。",
  summary: "配方后比较驻点与端点求最值",
});

describe("题目详解生成", () => {
  it("生成成功后写入详解并把纳入的讨论标记为已归档", async () => {
    const { app, upstream } = await setup(() => VALID_EXPLANATION);
    const baseline = (await bootstrap(app)).explanations.length;

    const response = await generate(app, QUESTION_ID);
    expect(response.status).toBe(201);
    const explanation = (await response.json()) as SolutionExplanation;

    expect(explanation.questionId).toBe(QUESTION_ID);
    expect(explanation.status).toBe("completed");
    expect(explanation.summary).toBe("配方后比较驻点与端点求最值");
    expect(explanation.turnIds.sort()).toEqual([...UNARCHIVED_TURNS].sort());
    expect(explanation.usage).toEqual({ inputTokens: 30, outputTokens: 20 });

    const body = upstream.bodies[0] as {
      model: string;
      temperature: number;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe("test-model");
    expect(body.temperature).toBe(0.2);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain("只输出 JSON");
    expect(body.messages[1].content).toContain("为什么一定要比较端点和顶点的值");
    // 未关联步骤的讨论不应遗漏
    expect(body.messages[1].content).toContain("未关联步骤的讨论");

    const after = await bootstrap(app);
    expect(after.explanations.length).toBe(baseline + 1);
    for (const turn of after.turns) {
      if (UNARCHIVED_TURNS.includes(turn.id)) {
        expect(turn.archiveStatus).toBe("archived");
      }
    }
  });

  it("首次返回非法 JSON 时重试一次并成功", async () => {
    const { app } = await setup((attempt) =>
      attempt === 1 ? "不是 JSON" : VALID_EXPLANATION,
    );

    const response = await generate(app, QUESTION_ID);
    expect(response.status).toBe(201);
    expect(((await response.json()) as SolutionExplanation).status).toBe("completed");
  });

  it("两次都非法时返回 502 且不写详解、不改讨论状态", async () => {
    const { app } = await setup(() => "不是 JSON");

    const response = await generate(app, QUESTION_ID);
    expect(response.status).toBe(502);

    const before = await bootstrap(app);
    const after = await bootstrap(app);
    expect(after.explanations.length).toBe(before.explanations.length);
    for (const turn of after.turns) {
      if (UNARCHIVED_TURNS.includes(turn.id)) {
        expect(turn.archiveStatus).toBe("unarchived");
      }
    }
  });

  it("没有分步题解时拒绝生成", async () => {
    const { app } = await setup(() => VALID_EXPLANATION);

    const response = await generate(app, "q-limit");
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe("NO_STEPS");
  });

  it("已有详解后再次生成时只纳入新产生的讨论", async () => {
    const { app } = await setup(() => VALID_EXPLANATION);
    expect((await generate(app, QUESTION_ID)).status).toBe(201);

    const second = await generate(app, QUESTION_ID);
    expect(second.status).toBe(400);
    expect(((await second.json()) as { code: string }).code).toBe("NO_DISCUSSION");
  });
});
