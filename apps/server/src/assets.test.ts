import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Question, QuestionAsset, WorkspaceData } from "@motive/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const GROUP_ID = "g-math";

interface RunningApp {
  baseUrl: string;
  uploadsDir: string;
  close: () => Promise<void>;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function png(tag: number): { mediaType: string; data: string } {
  return {
    mediaType: "image/png",
    data: Buffer.concat([PNG_SIGNATURE, Buffer.from([tag])]).toString("base64"),
  };
}

async function startApp(dbPath: string): Promise<RunningApp> {
  const uploadsDir = path.join(path.dirname(dbPath), "uploads");
  const app = createApp({ dbPath, uploadsDir });
  const server: Server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("测试服务器未获得端口");

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    uploadsDir,
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      (app.locals.db as DatabaseSync).close();
    },
  };
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function createQuestion(app: RunningApp, content = "已知函数 $f(x)=x^2$。"): Promise<Question> {
  const response = await fetch(`${app.baseUrl}/api/questions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ groupId: GROUP_ID, content }),
  });
  expect(response.status).toBe(201);
  return json<Question>(response);
}

function upload(app: RunningApp, questionId: string, images: unknown): Promise<Response> {
  return fetch(`${app.baseUrl}/api/questions/${questionId}/assets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ images }),
  });
}

async function bootstrap(app: RunningApp): Promise<WorkspaceData> {
  return json<WorkspaceData>(await fetch(`${app.baseUrl}/api/bootstrap`));
}

function storedFiles(app: RunningApp): string[] {
  try {
    return readdirSync(path.join(app.uploadsDir, "originals"));
  } catch {
    return [];
  }
}

describe("题目图片资源", () => {
  let dir: string;
  let app: RunningApp;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "motive-assets-"));
    app = await startApp(path.join(dir, "motive.db"));
  });

  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("上传图片后入库、落盘并可读取", async () => {
    const question = await createQuestion(app);

    const response = await upload(app, question.id, [png(1), png(2)]);
    expect(response.status).toBe(201);
    const created = (await json<{ assets: QuestionAsset[] }>(response)).assets;
    expect(created).toHaveLength(2);
    expect(created[0].url).toBe(`/api/assets/${created[0].id}`);
    expect(storedFiles(app)).toHaveLength(2);

    const listed = await json<{ assets: QuestionAsset[] }>(
      await fetch(`${app.baseUrl}/api/questions/${question.id}/assets`),
    );
    expect(listed.assets.map((asset) => asset.id)).toEqual(created.map((asset) => asset.id));

    const image = await fetch(`${app.baseUrl}/api/assets/${created[0].id}`);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toContain("image/png");
    expect(image.headers.get("cache-control")).toBe("no-store");

    const workspace = await bootstrap(app);
    const reloaded = workspace.questions.find((item) => item.id === question.id);
    expect(reloaded?.assets).toHaveLength(2);
    expect(reloaded?.imagePolicy).toBe("auto");
  });

  it("同一张图片重复上传复用已有资源", async () => {
    const question = await createQuestion(app);

    await upload(app, question.id, [png(7)]);
    const again = await upload(app, question.id, [png(7)]);
    expect(again.status).toBe(201);

    expect(storedFiles(app)).toHaveLength(1);
    const listed = await json<{ assets: QuestionAsset[] }>(
      await fetch(`${app.baseUrl}/api/questions/${question.id}/assets`),
    );
    expect(listed.assets).toHaveLength(1);
  });

  it("拒绝非法数据、伪造类型与超量图片", async () => {
    const question = await createQuestion(app);

    const empty = await upload(app, question.id, [{ mediaType: "image/png", data: "" }]);
    expect(empty.status).toBe(400);

    const fakeType = await upload(app, question.id, [
      {
        mediaType: "image/png",
        data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).toString("base64"),
      },
    ]);
    expect(fakeType.status).toBe(400);

    const unsupported = await upload(app, question.id, [{ mediaType: "image/gif", data: png(3).data }]);
    expect(unsupported.status).toBe(400);

    const tooMany = await upload(
      app,
      question.id,
      Array.from({ length: 5 }, (_, index) => png(10 + index)),
    );
    expect(tooMany.status).toBe(400);

    expect(storedFiles(app)).toHaveLength(0);
  });

  it("删除关联后清理无引用的磁盘文件", async () => {
    const question = await createQuestion(app);
    const shared = await createQuestion(app, "另一题");
    const asset = (await json<{ assets: QuestionAsset[] }>(await upload(app, question.id, [png(4)])))
      .assets[0];
    await upload(app, shared.id, [png(4)]);
    expect(storedFiles(app)).toHaveLength(1);

    // 仍被另一题引用时不删文件
    const firstDelete = await fetch(
      `${app.baseUrl}/api/questions/${question.id}/assets/${asset.id}`,
      { method: "DELETE" },
    );
    expect(firstDelete.status).toBe(200);
    expect(storedFiles(app)).toHaveLength(1);

    const secondDelete = await fetch(
      `${app.baseUrl}/api/questions/${shared.id}/assets/${asset.id}`,
      { method: "DELETE" },
    );
    expect(secondDelete.status).toBe(200);
    expect(storedFiles(app)).toHaveLength(0);
    expect((await json<{ assets: QuestionAsset[] }>(
      await fetch(`${app.baseUrl}/api/questions/${question.id}/assets`),
    )).assets).toHaveLength(0);
  });

  it("图片策略校验并回写", async () => {
    const question = await createQuestion(app);

    const invalid = await fetch(`${app.baseUrl}/api/questions/${question.id}/image-policy`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imagePolicy: "sometimes" }),
    });
    expect(invalid.status).toBe(400);

    const response = await fetch(`${app.baseUrl}/api/questions/${question.id}/image-policy`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imagePolicy: "never" }),
    });
    expect(response.status).toBe(200);
    expect((await json<Question>(response)).imagePolicy).toBe("never");

    const workspace = await bootstrap(app);
    expect(workspace.questions.find((item) => item.id === question.id)?.imagePolicy).toBe("never");
  });
});
