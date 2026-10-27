import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  createSseParser,
  type ChatStreamEvent,
  type ProviderSettingsView,
  type WorkspaceData,
} from "@motive/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";

interface RunningApp {
  baseUrl: string;
  db: DatabaseSync;
  close: () => Promise<void>;
}

interface RunningUpstream {
  baseUrl: string;
  lastBody: Record<string, unknown> | undefined;
  bodies: Array<Record<string, unknown>>;
  close: () => Promise<void>;
}

type UpstreamHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  body: Record<string, unknown> | undefined,
) => void;

const STEP_ID = "s-quad-1";

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
    db: app.locals.db as DatabaseSync,
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

async function startUpstream(handler: UpstreamHandler): Promise<RunningUpstream> {
  const record: RunningUpstream = {
    baseUrl: "",
    lastBody: undefined,
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
      record.lastBody = body;
      if (body) record.bodies.push(body);
      handler(req, res, body);
    });
  });

  server.listen(0, "127.0.0.1");
  const port = await listen(server);
  record.baseUrl = `http://127.0.0.1:${port}/v1`;
  return record;
}

function writeOkStream(res: ServerResponse) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
  });
  res.write('data: {"choices":[{"delta":{"content":"你"}}]}\n\n');
  // 故意在 JSON 中间断开，验证跨 chunk 解析
  res.write('data: {"choices":[{"delta":{"content":"');
  setTimeout(() => {
    res.write('好"}}]}\n\n');
    res.write(
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":3}}\n\n',
    );
    res.write("data: [DONE]\n\n");
    res.end();
  }, 5);
}

async function readEvents(response: Response): Promise<ChatStreamEvent[]> {
  if (!response.body) throw new Error("响应没有 body");
  const parser = createSseParser();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: ChatStreamEvent[] = [];

  const dispatch = (payloads: string[]) => {
    for (const payload of payloads) {
      const trimmed = payload.trim();
      if (!trimmed || trimmed === "[DONE]") continue;
      events.push(JSON.parse(trimmed) as ChatStreamEvent);
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    dispatch(parser.push(decoder.decode(value, { stream: true })));
  }
  dispatch(parser.flush());
  return events;
}

async function configureProvider(
  app: RunningApp,
  upstream: RunningUpstream,
  apiKey = "sk-test-secret",
): Promise<ProviderSettingsView> {
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
      apiKey,
    }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as ProviderSettingsView;
}

async function sendStream(
  app: RunningApp,
  userMessage: string,
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(`${app.baseUrl}/api/steps/${STEP_ID}/messages/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userMessage }),
    signal,
  });
}

function turnsFor(data: WorkspaceData, stepId = STEP_ID) {
  const sub = data.subs.find((item) => item.entryStepId === stepId);
  if (!sub) return [];
  return sub.turnIds
    .map((id) => data.turns.find((turn) => turn.id === id))
    .filter((turn): turn is WorkspaceData["turns"][number] => Boolean(turn));
}

async function bootstrap(app: RunningApp): Promise<WorkspaceData> {
  const response = await fetch(`${app.baseUrl}/api/bootstrap`);
  return (await response.json()) as WorkspaceData;
}

async function waitFor<T>(
  probe: () => Promise<T | undefined>,
  timeoutMs = 3000,
): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await probe();
    if (result !== undefined) return result;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error("等待超时");
}

let workDir: string;
let apps: RunningApp[] = [];
let upstreams: RunningUpstream[] = [];

beforeEach(() => {
  workDir = mkdtempSync(path.join(tmpdir(), "motive-chat-"));
  apps = [];
  upstreams = [];
});

afterEach(async () => {
  for (const app of apps) await app.close();
  for (const upstream of upstreams) await upstream.close();
  rmSync(workDir, { recursive: true, force: true });
});

async function setup(handler: UpstreamHandler) {
  const app = await startApp(path.join(workDir, "test.db"));
  apps.push(app);
  const upstream = await startUpstream(handler);
  upstreams.push(upstream);
  await configureProvider(app, upstream);
  return { app, upstream };
}

describe("Provider 设置", () => {
  it("默认未配置 Key，且拒绝非 localhost 的 HTTP 地址", async () => {
    const app = await startApp(path.join(workDir, "settings.db"));
    apps.push(app);

    const initial = await fetch(`${app.baseUrl}/api/settings/provider`);
    const view = (await initial.json()) as ProviderSettingsView;
    expect(view.hasApiKey).toBe(false);
    expect(view.provider.baseUrl).toMatch(/^https:/);

    const rejected = await fetch(`${app.baseUrl}/api/settings/provider`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: {
          id: "default",
          name: "Bad",
          baseUrl: "http://example.com/v1",
          model: "m",
          protocol: "openai-chat-completions",
        },
        apiKey: "sk-x",
      }),
    });
    expect(rejected.status).toBe(400);
    expect(((await rejected.json()) as { code: string }).code).toBe("INVALID_CONFIG");
  });

  it("保存后不回传 Key，备份中也不含 Key 与 Provider 配置", async () => {
    const app = await startApp(path.join(workDir, "key.db"));
    apps.push(app);

    const saved = await fetch(`${app.baseUrl}/api/settings/provider`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: {
          id: "default",
          name: "OpenAI",
          baseUrl: "https://api.openai.com/v1",
          model: "gpt-4o-mini",
          protocol: "openai-chat-completions",
          temperature: 0.5,
        },
        apiKey: "sk-secret-value",
      }),
    });
    expect(saved.status).toBe(200);
    const savedText = await saved.text();
    expect(savedText).not.toContain("sk-secret-value");
    expect((JSON.parse(savedText) as ProviderSettingsView).hasApiKey).toBe(true);

    const backup = await fetch(`${app.baseUrl}/api/backup`);
    const backupText = await backup.text();
    expect(backupText).not.toContain("sk-secret-value");
    expect(backupText).not.toContain("provider_config");

    const cleared = await fetch(`${app.baseUrl}/api/settings/provider`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: {
          id: "default",
          name: "OpenAI",
          baseUrl: "https://api.openai.com/v1",
          model: "gpt-4o-mini",
          protocol: "openai-chat-completions",
        },
        clearApiKey: true,
      }),
    });
    expect(((await cleared.json()) as ProviderSettingsView).hasApiKey).toBe(false);
  });
});

describe("流式对话", () => {
  it("按顺序输出事件，落库内容与用量正确，并把上下文传给上游", async () => {
    const { app, upstream } = await setup((_req, res) => writeOkStream(res));

    const response = await sendStream(app, "这一步为什么要配方？");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const events = await readEvents(response);
    expect(events.slice(0, 2)).toEqual([
      { type: "text-delta", text: "你" },
      { type: "text-delta", text: "好" },
    ]);
    expect(events).toContainEqual({ type: "usage", inputTokens: 12, outputTokens: 3 });
    expect(events.at(-1)).toEqual({ type: "completed", finishReason: "stop" });

    const body = upstream.lastBody as {
      model: string;
      stream: boolean;
      temperature: number;
      stream_options: { include_usage: boolean };
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe("test-model");
    expect(body.stream).toBe(true);
    expect(body.stream_options.include_usage).toBe(true);
    expect(body.temperature).toBe(0.5);
    expect(body.messages[0].role).toBe("system");
    const prompt = body.messages[1].content;
    expect(prompt).toContain("已知函数");
    expect(prompt).toContain("[s-quad-1]");
    expect(prompt).toContain("入口步骤「配方并读出顶点」");
    expect(prompt).toContain("暂无历史讨论");
    expect(prompt).toContain("这一步为什么要配方？");

    const data = await bootstrap(app);
    const turns = turnsFor(data);
    expect(turns).toHaveLength(1);
    expect(turns[0].userMessage).toBe("这一步为什么要配方？");
    expect(turns[0].assistantMessage).toBe("你好");
    expect(turns[0].generationStatus).toBe("completed");
    expect(turns[0].chatUsage).toEqual({ inputTokens: 12, outputTokens: 3 });

    // 第二轮应包含最近历史
    const second = await sendStream(app, "那区间端点呢？");
    await readEvents(second);
    const secondPrompt = (
      upstream.lastBody as { messages: Array<{ role: string; content: string }> }
    ).messages[1].content;
    expect(secondPrompt).toContain("用户：这一步为什么要配方？");
    expect(secondPrompt).toContain("助手：你好");
    expect(secondPrompt).toContain("那区间端点呢？");
  });

  it("上游 401 映射为 AUTH_FAILED，并保留用户消息与空回复", async () => {
    const { app } = await setup((_req, res) => {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "invalid api key" } }));
    });

    const response = await sendStream(app, "为什么是 401？");
    expect(response.status).toBe(200);

    const events = await readEvents(response);
    const last = events.at(-1);
    expect(last?.type).toBe("error");
    if (last?.type === "error") {
      expect(last.code).toBe("AUTH_FAILED");
      expect(last.message).toContain("模型服务返回错误");
    }

    const turns = turnsFor(await bootstrap(app));
    expect(turns).toHaveLength(1);
    expect(turns[0].userMessage).toBe("为什么是 401？");
    expect(turns[0].assistantMessage).toBe("");
    expect(turns[0].generationStatus).toBe("interrupted");
  });

  it("上游 429 映射为 RATE_LIMITED", async () => {
    const { app } = await setup((_req, res) => {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "slow down" } }));
    });

    const events = await readEvents(await sendStream(app, "限流测试"));
    const last = events.at(-1);
    expect(last?.type).toBe("error");
    if (last?.type === "error") expect(last.code).toBe("RATE_LIMITED");
  });

  it("未配置 API Key 时返回普通 JSON 400，不进入 SSE", async () => {
    const app = await startApp(path.join(workDir, "nokey.db"));
    apps.push(app);

    const response = await sendStream(app, "没有 Key");
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("INVALID_CONFIG");
  });

  it("客户端中断后保存已接收文本并标记 interrupted", async () => {
    const { app } = await setup((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write('data: {"choices":[{"delta":{"content":"你"}}]}\n\n');
      const timer = setInterval(() => {
        if (!res.writableEnded) res.write(": ping\n\n");
      }, 50);
      res.on("close", () => clearInterval(timer));
    });

    const controller = new AbortController();
    const response = await sendStream(app, "先停下", controller.signal);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const first = await reader.read();
    expect(decoder.decode(first.value)).toContain("你");

    controller.abort();
    await reader.read().catch(() => undefined);

    const turn = await waitFor(async () => {
      const turns = turnsFor(await bootstrap(app));
      return turns.find((item) => item.userMessage === "先停下");
    });
    expect(turn.generationStatus).toBe("interrupted");
    expect(turn.assistantMessage).toBe("你");
  });
});

describe("连接测试", () => {
  it("成功时返回模型与耗时", async () => {
    const { app } = await setup((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write('data: {"choices":[{"delta":{"content":"OK"}}]}\n\n');
      res.write("data: [DONE]\n\n");
      res.end();
    });

    const response = await fetch(`${app.baseUrl}/api/settings/provider/test`, {
      method: "POST",
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      model: string;
      latencyMs: number;
    };
    expect(body.ok).toBe(true);
    expect(body.model).toBe("test-model");
    expect(body.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("Key 无效时返回 AUTH_FAILED", async () => {
    const { app } = await setup((_req, res) => {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "unauthorized" } }));
    });

    const response = await fetch(`${app.baseUrl}/api/settings/provider/test`, {
      method: "POST",
    });
    expect(response.status).toBe(401);
    expect(((await response.json()) as { code: string }).code).toBe("AUTH_FAILED");
  });
});
