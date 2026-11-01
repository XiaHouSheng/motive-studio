import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Express } from "express";
import type { ProviderSettingsView } from "@motive/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { DEFAULT_PROMPTS } from "./services/ai/effective-prompt.js";
import type { PromptStage } from "@motive/shared";

const IMAGE = { mediaType: "image/png", data: "iVBORw0KGgo=" };
const CUSTOM = "自定义提示词：所有输出必须使用英文。";

interface RunningApp {
  baseUrl: string;
  app: Express;
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

async function start(dbPath: string): Promise<RunningApp> {
  const app = createApp({ dbPath, uploadsDir: path.join(path.dirname(dbPath), "uploads") });
  const server = app.listen(0, "127.0.0.1");
  const port = await listen(server);

  let closed = false;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    app,
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      app.locals.db.close();
    },
  };
}

function call<T>(
  running: RunningApp,
  method: string,
  route: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  return fetch(`${running.baseUrl}${route}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (response) => ({
    status: response.status,
    body: (await response.json()) as T,
  }));
}

async function startUpstream(respond: () => string): Promise<RunningUpstream> {
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
        // 忽略非 JSON 请求体
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      });
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: respond() } }] })}\n\n`,
      );
      res.write(
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":30,"completion_tokens":20}}\n\n',
      );
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });

  server.listen(0, "127.0.0.1");
  const port = await listen(server);
  record.baseUrl = `http://127.0.0.1:${port}/v1`;
  return record;
}

async function configureProvider(app: RunningApp, upstream: RunningUpstream): Promise<void> {
  const response = await call<ProviderSettingsView>(app, "PUT", "/api/settings/provider", {
    provider: {
      id: "default",
      name: "Test Provider",
      baseUrl: upstream.baseUrl,
      model: "test-model",
      protocol: "openai-chat-completions",
    },
    apiKey: "sk-test",
  });
  expect(response.status).toBe(200);
}

/** 记录 upstream 收到的 system 提示词（取最后一次请求） */
function lastSystemPrompt(upstream: RunningUpstream): string {
  const body = upstream.bodies[upstream.bodies.length - 1];
  const messages = body.messages as Array<{ role: string; content: unknown }>;
  expect(messages[0].role).toBe("system");
  return messages[0].content as string;
}

describe("提示词设置接口", () => {
  let dir: string;
  let dbPath: string;
  let running: RunningApp;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "motive-settings-"));
    dbPath = path.join(dir, "motive.db");
    running = await start(dbPath);
  });

  afterEach(async () => {
    await running.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("GET 返回代码内置默认值与空覆盖", async () => {
    const response = await call<{
      settings: Record<string, string>;
      defaults: Record<string, string>;
    }>(running, "GET", "/api/settings/prompts");
    expect(response.status).toBe(200);
    for (const stage of Object.keys(DEFAULT_PROMPTS) as PromptStage[]) {
      expect(response.body.settings[stage]).toBe("");
      expect(response.body.defaults[stage]).toBe(DEFAULT_PROMPTS[stage]);
      expect(response.body.defaults[stage].length).toBeGreaterThan(0);
    }
  });

  it("PUT 部分更新：只覆盖出现的 stage，未出现的保留原值", async () => {
    const first = await call<unknown>(running, "PUT", "/api/settings/prompts", {
      settings: { solution_generation: CUSTOM },
    });
    expect(first.status).toBe(200);

    const second = await call<{ settings: Record<string, string> }>(
      running,
      "PUT",
      "/api/settings/prompts",
      { settings: { step_discussion: "另一个提示词" } },
    );
    expect(second.status).toBe(200);
    expect(second.body.settings.solution_generation).toBe(CUSTOM);
    expect(second.body.settings.step_discussion).toBe("另一个提示词");
    expect(second.body.settings.image_import).toBe("");
  });

  it("空白提示词等价恢复默认，且不把默认文本写入数据库", async () => {
    await call<unknown>(running, "PUT", "/api/settings/prompts", {
      settings: { solution_generation: CUSTOM },
    });
    const restored = await call<{ settings: Record<string, string> }>(
      running,
      "PUT",
      "/api/settings/prompts",
      { settings: { solution_generation: "   \n\t " } },
    );
    expect(restored.status).toBe(200);
    expect(restored.body.settings.solution_generation).toBe("");

    // 数据库只存覆盖值（恢复默认后应无该键），默认文案始终来自代码
    const db = running.app.locals.db as {
      prepare: (sql: string) => { get: () => { value: string } | undefined };
    };
    const row = db.prepare("SELECT value FROM app_settings WHERE key = 'prompt_config'").get();
    if (row) {
      expect(JSON.parse(row.value)).not.toHaveProperty("solution_generation");
    }
  });

  it("非法请求返回 400 且原配置保持不变", async () => {
    await call<unknown>(running, "PUT", "/api/settings/prompts", {
      settings: { solution_generation: CUSTOM },
    });

    const unknownStage = await call<{ code: string }>(running, "PUT", "/api/settings/prompts", {
      settings: { unknown_stage: "x" },
    });
    expect(unknownStage.status).toBe(400);

    const nonString = await call<{ code: string }>(running, "PUT", "/api/settings/prompts", {
      settings: { step_discussion: 123 },
    });
    expect(nonString.status).toBe(400);

    const tooLong = await call<{ code: string }>(running, "PUT", "/api/settings/prompts", {
      settings: { step_discussion: "a".repeat(20_001) },
    });
    expect(tooLong.status).toBe(400);

    const after = await call<{ settings: Record<string, string> }>(
      running,
      "GET",
      "/api/settings/prompts",
    );
    expect(after.body.settings.solution_generation).toBe(CUSTOM);
    expect(after.body.settings.step_discussion).toBe("");
  });

  it("单次请求混合合法与非法字段时整次失败，不允许部分写入", async () => {
    const response = await call<{ code: string }>(running, "PUT", "/api/settings/prompts", {
      settings: {
        solution_generation: "合法的新提示词",
        step_discussion: 42,
      },
    });
    expect(response.status).toBe(400);

    const after = await call<{ settings: Record<string, string> }>(
      running,
      "GET",
      "/api/settings/prompts",
    );
    expect(after.body.settings.solution_generation).toBe("");
    expect(after.body.settings.step_discussion).toBe("");
  });

  it("重启后自定义提示词仍然生效", async () => {
    await call<unknown>(running, "PUT", "/api/settings/prompts", {
      settings: { explanation_generation: CUSTOM },
    });
    await running.close();

    running = await start(dbPath);
    const after = await call<{ settings: Record<string, string> }>(
      running,
      "GET",
      "/api/settings/prompts",
    );
    expect(after.body.settings.explanation_generation).toBe(CUSTOM);
  });
});

describe("界面偏好接口", () => {
  let dir: string;
  let running: RunningApp;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "motive-ui-prefs-"));
    running = await start(path.join(dir, "motive.db"));
  });

  afterEach(async () => {
    await running.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function putUi(body: unknown) {
    return call<{ theme: string; language: string }>(running, "PUT", "/api/settings/ui", body);
  }

  it("GET 返回默认偏好", async () => {
    const response = await call<{ theme: string; language: string }>(
      running,
      "GET",
      "/api/settings/ui",
    );
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ theme: "system", language: "zh-CN" });
  });

  it("仅修改语言时主题保持不变，反之亦然", async () => {
    const languageOnly = await putUi({ language: "en" });
    expect(languageOnly.body).toEqual({ theme: "system", language: "en" });

    const themeOnly = await putUi({ theme: "dark" });
    expect(themeOnly.body).toEqual({ theme: "dark", language: "en" });
  });

  it("连续更新两项偏好不发生字段覆盖", async () => {
    await putUi({ theme: "dark" });
    const final = await putUi({ language: "en" });
    expect(final.body).toEqual({ theme: "dark", language: "en" });
  });

  it("两项偏好并发更新最终均正确", async () => {
    const [first, second] = await Promise.all([
      putUi({ language: "en" }),
      putUi({ theme: "dark" }),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const after = await call<{ theme: string; language: string }>(
      running,
      "GET",
      "/api/settings/ui",
    );
    expect(after.body).toEqual({ theme: "dark", language: "en" });
  });

  it("非法值与未知字段返回 400 且原配置不变", async () => {
    await putUi({ theme: "dark", language: "en" });

    expect((await putUi({ theme: "blue" })).status).toBe(400);
    expect((await putUi({ language: "fr" })).status).toBe(400);
    expect((await putUi({ theme: 1 })).status).toBe(400);
    expect((await putUi({ locale: "zh-CN" })).status).toBe(400);

    const after = await call<{ theme: string; language: string }>(
      running,
      "GET",
      "/api/settings/ui",
    );
    expect(after.body).toEqual({ theme: "dark", language: "en" });
  });
});

describe("五个环节生效自定义提示词", () => {
  let dir: string;
  let app: RunningApp;
  let upstream: RunningUpstream | undefined;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "motive-stage-prompts-"));
    app = await start(path.join(dir, "motive.db"));
    upstream = undefined;
  });

  afterEach(async () => {
    await app.close();
    if (upstream) await upstream.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function setPrompt(stage: string, value: string) {
    const response = await call<unknown>(app, "PUT", "/api/settings/prompts", {
      settings: { [stage]: value },
    });
    expect(response.status).toBe(200);
  }

  async function appendTurn(): Promise<string> {
    const response = await call<{ subConversation: { id: string } }>(
      app,
      "POST",
      "/api/steps/s-quad-1/messages",
      { userMessage: "为什么先配方？", assistantMessage: "配方可以直接读出顶点。" },
    );
    expect(response.status).toBe(201);
    return response.body.subConversation.id;
  }

  it("题目图片识别（桌面端与手机拍照同配置）", async () => {
    upstream = await startUpstream(() => JSON.stringify({ questions: ["题目一"] }));
    await configureProvider(app, upstream);
    await setPrompt("image_import", CUSTOM);

    const response = await call<{ questions: string[] }>(
      app,
      "POST",
      "/api/question-groups/g-math/image-import",
      { images: [IMAGE] },
    );
    expect(response.status).toBe(200);
    expect(lastSystemPrompt(upstream)).toBe(CUSTOM);
  });

  it("分步题解；未配置覆盖时发送内置默认提示词", async () => {
    upstream = await startUpstream(() =>
      JSON.stringify({ steps: [{ title: "第一步", content: "内容" }] }),
    );
    await configureProvider(app, upstream);

    // 覆盖生效
    await setPrompt("solution_generation", CUSTOM);
    let response = await call<unknown>(app, "POST", "/api/questions/q-quad/solution/generate");
    expect(response.status).toBe(201);
    expect(lastSystemPrompt(upstream)).toBe(CUSTOM);

    // 恢复默认（存空串）后发送内置默认
    await setPrompt("solution_generation", "");
    response = await call<unknown>(app, "POST", "/api/questions/q-quad/solution/generate");
    expect(response.status).toBe(201);
    expect(lastSystemPrompt(upstream)).toBe(DEFAULT_PROMPTS.solution_generation);
  });

  it("步骤讨论", async () => {
    upstream = await startUpstream(() => "回复内容");
    await configureProvider(app, upstream);
    await setPrompt("step_discussion", CUSTOM);

    const response = await fetch(`${app.baseUrl}/api/steps/s-quad-1/messages/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userMessage: "为什么？" }),
    });
    expect(response.status).toBe(200);
    await response.text();
    expect(lastSystemPrompt(upstream)).toBe(CUSTOM);
  });

  it("题目详解", async () => {
    upstream = await startUpstream(() =>
      JSON.stringify({
        explanation: "# 第一步\n\n先配方，再求最值，过程完整且连贯。",
        summary: "概述",
      }),
    );
    await configureProvider(app, upstream);
    await setPrompt("explanation_generation", CUSTOM);
    await appendTurn();

    const response = await call<unknown>(
      app,
      "POST",
      "/api/questions/q-quad/explanations/generate",
    );
    expect(response.status).toBe(201);
    expect(lastSystemPrompt(upstream)).toBe(CUSTOM);
  });

  it("归档提案", async () => {
    upstream = await startUpstream(() => JSON.stringify({ summary: "概述", changes: [] }));
    await configureProvider(app, upstream);
    await setPrompt("archive_proposal", CUSTOM);
    const subId = await appendTurn();

    const response = await call<unknown>(app, "POST", `/api/discussions/${subId}/archive`);
    expect(response.status).toBe(201);
    expect(lastSystemPrompt(upstream)).toBe(CUSTOM);
  });
});
