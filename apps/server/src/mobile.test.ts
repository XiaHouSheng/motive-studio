import { randomUUID } from "node:crypto";
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

/** 模拟桌面端注册凭证，返回 token */
async function registerLink(app: RunningApp): Promise<string> {
  const response = await fetch(`${app.baseUrl}/api/mobile/link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: randomUUID() }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    token: string;
    urls: string[];
    preferred: string | null;
  };
  expect(body.urls.every((url) => url.includes("/m?t="))).toBe(true);
  expect(body.preferred).toBe(body.urls[0] ?? null);
  return body.token;
}

function mobileApi(
  app: RunningApp,
  token: string,
  apiPath: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${app.baseUrl}${apiPath}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Mobile-Token": token,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function bootstrap(app: RunningApp): Promise<WorkspaceData> {
  const response = await fetch(`${app.baseUrl}/api/bootstrap`);
  return (await response.json()) as WorkspaceData;
}

describe("手机拍照导入（凭证机制）", () => {
  let dir: string;
  let app: RunningApp;
  let upstream: RunningUpstream | undefined;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "motive-mobile-"));
    app = await startApp(path.join(dir, "motive.db"));
    upstream = undefined;
  });

  afterEach(async () => {
    await app.close();
    if (upstream) await upstream.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("无凭证访问手机页返回 403 拒绝页", async () => {
    const response = await fetch(`${app.baseUrl}/m`);
    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("无法访问");
  });

  it("带凭证访问手机页返回拍照上传页", async () => {
    const token = await registerLink(app);

    const response = await fetch(`${app.baseUrl}/m?t=${token}`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("拍照导入题目");
    expect(html).toContain('capture="environment"');
    expect(html).toContain('id="step-target"');
  });

  it("注册接口校验 key 必须为 UUID", async () => {
    const response = await fetch(`${app.baseUrl}/api/mobile/link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "not-a-uuid" }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("INVALID_FIELD");
  });

  it("未注册的 token 无法访问移动端接口与二维码", async () => {
    const groups = await fetch(`${app.baseUrl}/api/mobile/groups`, {
      headers: { "X-Mobile-Token": randomUUID() },
    });
    expect(groups.status).toBe(403);
    expect((await groups.json()).code).toBe("UNAUTHORIZED");

    const anonymous = await fetch(`${app.baseUrl}/api/mobile/groups`);
    expect(anonymous.status).toBe(403);

    const qr = await fetch(
      `${app.baseUrl}/api/mobile/qr.svg?url=${encodeURIComponent(`${app.baseUrl}/m?t=x`)}`,
    );
    expect(qr.status).toBe(200);
    expect(qr.headers.get("content-type")).toContain("image/svg+xml");

    const foreign = await fetch(
      `${app.baseUrl}/api/mobile/qr.svg?url=${encodeURIComponent("http://example.com/m?t=x")}`,
    );
    expect(foreign.status).toBe(400);
  });

  it("列为题组摘要并随凭证返回", async () => {
    const token = await registerLink(app);
    const response = await mobileApi(app, token, "/api/mobile/groups");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      groups: Array<{ id: string; title: string; questionCount: number }>;
    };
    expect(body.groups.map((group) => group.id)).toEqual(["g-math", "g-calc"]);
    expect(body.groups[0]).toEqual({ id: "g-math", title: "函数与导数", questionCount: 2 });
  });

  it("识别图片中的题目并保留图片 data URL", async () => {
    upstream = await startUpstream(() =>
      JSON.stringify({ questions: ["求 $1+1$ 的值。", "证明 $\\sqrt{3}$ 是无理数。"] }),
    );
    await configureProvider(app, upstream);
    const token = await registerLink(app);

    const response = await mobileApi(app, token, "/api/mobile/extract", { images: [IMAGE] });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      questions: ["求 $1+1$ 的值。", "证明 $\\sqrt{3}$ 是无理数。"],
    });

    expect(upstream.bodies).toHaveLength(1);
    const body = upstream.bodies[0];
    expect(body.temperature).toBe(0.1);
    const messages = body.messages as Array<{ role: string; content: unknown }>;
    const parts = messages[1].content as Array<Record<string, unknown>>;
    expect(parts.some((part) => part.type === "image_url")).toBe(true);
    expect(JSON.stringify(parts).includes("data:image/png;base64,iVBORw0KGgo=")).toBe(true);
  });

  it("未配置 API Key 时识别返回 400", async () => {
    const token = await registerLink(app);
    const response = await mobileApi(app, token, "/api/mobile/extract", { images: [IMAGE] });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("INVALID_CONFIG");
  });

  it("提交到已有题组：题数递增且 position 递增", async () => {
    const token = await registerLink(app);
    const before = await bootstrap(app);
    const beforeIds = new Set(before.questions.map((question) => question.id));

    const response = await mobileApi(app, token, "/api/mobile/commit", {
      target: { type: "existing", groupId: GROUP_ID },
      questions: ["新题一", "新题二"],
    });
    expect(response.status).toBe(200);
    const result = (await response.json()) as {
      groupId: string;
      groupTitle: string;
      questions: Array<{ id: string; groupId: string; content: string }>;
    };
    expect(result.groupId).toBe(GROUP_ID);
    expect(result.groupTitle).toBe("函数与导数");
    expect(result.questions.map((question) => question.content)).toEqual(["新题一", "新题二"]);

    const after = await bootstrap(app);
    const group = after.groups.find((item) => item.id === GROUP_ID);
    expect(group?.questionIds).toEqual([
      "q-quad",
      "q-tangent",
      ...result.questions.map((question) => question.id),
    ]);
    for (const created of result.questions) {
      expect(beforeIds.has(created.id)).toBe(false);
      expect(after.questions.find((item) => item.id === created.id)?.groupId).toBe(GROUP_ID);
    }
  });

  it("提交新建题组：使用给定标题，空标题回退默认名", async () => {
    const token = await registerLink(app);

    const named = await mobileApi(app, token, "/api/mobile/commit", {
      target: { type: "new", title: "周末作业" },
      questions: ["新题"],
    });
    expect(named.status).toBe(200);
    expect(((await named.json()) as { groupTitle: string }).groupTitle).toBe("周末作业");

    const fallback = await mobileApi(app, token, "/api/mobile/commit", {
      target: { type: "new", title: "   " },
      questions: ["另一题"],
    });
    expect(fallback.status).toBe(200);
    const fallbackBody = (await fallback.json()) as { groupId: string; groupTitle: string };
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, "0");
    expect(fallbackBody.groupTitle).toBe(
      `拍照导入 ${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    );

    const after = await bootstrap(app);
    expect(after.groups.some((group) => group.id === fallbackBody.groupId)).toBe(true);
  });

  it("提交接口校验 target 与题目内容", async () => {
    const token = await registerLink(app);

    const emptyQuestions = await mobileApi(app, token, "/api/mobile/commit", {
      target: { type: "existing", groupId: GROUP_ID },
      questions: [],
    });
    expect(emptyQuestions.status).toBe(400);

    const tooMany = await mobileApi(app, token, "/api/mobile/commit", {
      target: { type: "existing", groupId: GROUP_ID },
      questions: Array.from({ length: 31 }, (_, index) => `题 ${index}`),
    });
    expect(tooMany.status).toBe(400);

    const badTarget = await mobileApi(app, token, "/api/mobile/commit", {
      target: { type: "somewhere" },
      questions: ["题"],
    });
    expect(badTarget.status).toBe(400);

    const missingGroup = await mobileApi(app, token, "/api/mobile/commit", {
      target: { type: "existing", groupId: "g-missing" },
      questions: ["题"],
    });
    expect(missingGroup.status).toBe(404);

    const before = await bootstrap(app);
    expect(before.questions.filter((question) => question.content === "题")).toHaveLength(0);
  });
});
