import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type {
  ProviderSettingsView,
  Question,
  SolutionExplanation,
  WorkspaceData,
} from "@motive/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const QUESTION_ID = "q-quad";
// 种子中的全部轮次：详解上下文不再按归档状态过滤，t-4 也应纳入
const SEEDED_TURNS = ["t-1", "t-2", "t-3", "t-4"];

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
  it("生成成功后写入详解并纳入全部讨论轮次", async () => {
    const { app, upstream } = await setup(() => VALID_EXPLANATION);
    const baseline = (await bootstrap(app)).explanations.length;

    const response = await generate(app, QUESTION_ID);
    expect(response.status).toBe(201);
    const explanation = (await response.json()) as SolutionExplanation;

    expect(explanation.questionId).toBe(QUESTION_ID);
    expect(explanation.status).toBe("completed");
    expect(explanation.summary).toBe("配方后比较驻点与端点求最值");
    expect(explanation.turnIds.sort()).toEqual([...SEEDED_TURNS].sort());
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
    // 全部轮次都进入上下文，不再有「已归档排除」
    expect(body.messages[1].content).toContain("最大值为什么不是右端点");
    // 未关联步骤的讨论不应遗漏
    expect(body.messages[1].content).toContain("未关联步骤的讨论");

    const after = await bootstrap(app);
    expect(after.explanations.length).toBe(baseline + 1);
  });

  it("首次返回非法 JSON 时重试一次并成功", async () => {
    const { app } = await setup((attempt) =>
      attempt === 1 ? "不是 JSON" : VALID_EXPLANATION,
    );

    const response = await generate(app, QUESTION_ID);
    expect(response.status).toBe(201);
    expect(((await response.json()) as SolutionExplanation).status).toBe("completed");
  });

  it("两次都非法时返回 502 且不写详解", async () => {
    const { app } = await setup(() => "不是 JSON");

    const before = await bootstrap(app);
    const response = await generate(app, QUESTION_ID);
    expect(response.status).toBe(502);

    const after = await bootstrap(app);
    expect(after.explanations.length).toBe(before.explanations.length);
  });

  it("没有分步题解时拒绝生成", async () => {
    const { app } = await setup(() => VALID_EXPLANATION);

    const response = await generate(app, "q-limit");
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe("NO_STEPS");
  });

  it("重复生成时讨论上下文保持一致", async () => {
    const { app, upstream } = await setup(() => VALID_EXPLANATION);
    const baseline = (await bootstrap(app)).explanations.filter(
      (explanation) => explanation.questionId === QUESTION_ID,
    ).length;

    expect((await generate(app, QUESTION_ID)).status).toBe(201);
    const second = await generate(app, QUESTION_ID);
    expect(second.status).toBe(201);

    const explanations = (await bootstrap(app)).explanations.filter(
      (explanation) => explanation.questionId === QUESTION_ID,
    );
    expect(explanations.length).toBe(baseline + 2);

    // 轮次不被消费：两次请求的用户上下文逐字一致
    const firstBody = upstream.bodies[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const secondBody = upstream.bodies[1] as typeof firstBody;
    expect(secondBody.messages[1].content).toBe(firstBody.messages[1].content);
    expect(firstBody.messages[1].content).toContain("为什么一定要比较端点和顶点的值");
  });

  it("没有任何讨论时也能直接生成详解", async () => {
    const { app, upstream } = await setup(() => VALID_EXPLANATION);
    const workspace = await bootstrap(app);

    const questionResponse = await fetch(`${app.baseUrl}/api/questions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        groupId: workspace.groups[0]?.id,
        content: "计算定积分 $\\int_0^1 x^2\\,dx$。",
      }),
    });
    expect(questionResponse.status).toBe(201);
    const question = (await questionResponse.json()) as Question;

    const stepTitles = ["确定原函数", "代入上下限"];
    for (const [index, title] of stepTitles.entries()) {
      const stepResponse = await fetch(
        `${app.baseUrl}/api/questions/${encodeURIComponent(question.id)}/steps`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, content: `第 ${index + 1} 步的推导内容。` }),
        },
      );
      expect(stepResponse.status).toBe(201);
    }

    const response = await generate(app, question.id);
    expect(response.status).toBe(201);
    const explanation = (await response.json()) as SolutionExplanation;
    expect(explanation.status).toBe("completed");
    expect(explanation.turnIds).toEqual([]);
    expect(explanation.content.length).toBeGreaterThan(0);

    const body = upstream.bodies[0] as {
      messages: Array<{ role: string; content: string }>;
    };
    // 空讨论上下文可正常构建
    expect(body.messages[1].content).toContain("本步骤暂无关联讨论");
    expect(body.messages[1].content).toContain("（无）");
  });
});
