import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type {
  BackupPayload,
  QuestionGroup,
  SolutionStep,
  SubConversation,
  TurnStepTag,
  ConversationTurn,
  WorkspaceData,
} from "@motive/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";

interface RunningApp {
  baseUrl: string;
  app: ReturnType<typeof createApp>;
  close: () => Promise<void>;
}

interface ApiResult<T> {
  status: number;
  body: T;
}

async function start(dbPath: string): Promise<RunningApp> {
  const app = createApp({ dbPath });
  const server: Server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("测试服务器未获得端口");
  }

  let closed = false;
  return {
    app,
    baseUrl: `http://127.0.0.1:${address.port}`,
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

async function call<T>(
  running: RunningApp,
  method: string,
  route: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  const response = await fetch(`${running.baseUrl}${route}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: (text ? JSON.parse(text) : undefined) as T,
  };
}

describe("Motive Studio 数据层", () => {
  let dir: string;
  let dbPath: string;
  let running: RunningApp;

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "motive-studio-test-"));
    dbPath = path.join(dir, "motive.db");
    running = await start(dbPath);
  });

  afterEach(async () => {
    await running.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("首次启动写入种子数据，重启后新增数据仍在", async () => {
    const first = await call<WorkspaceData>(running, "GET", "/api/bootstrap");
    expect(first.status).toBe(200);
    expect(first.body.groups).toHaveLength(2);
    expect(first.body.steps.length).toBeGreaterThan(0);

    const created = await call<QuestionGroup>(running, "POST", "/api/question-groups", {
      title: "新增题组",
    });
    expect(created.status).toBe(201);

    await running.close();
    running = await start(dbPath);

    const second = await call<WorkspaceData>(running, "GET", "/api/bootstrap");
    expect(second.body.groups.some((group) => group.id === created.body.id)).toBe(true);

    const removed = await call<{ ok: true }>(
      running,
      "DELETE",
      `/api/question-groups/${created.body.id}`,
    );
    expect(removed.status).toBe(200);

    await running.close();
    running = await start(dbPath);

    const third = await call<WorkspaceData>(running, "GET", "/api/bootstrap");
    expect(third.body.groups.some((group) => group.id === created.body.id)).toBe(false);
    expect(third.body.groups).toHaveLength(2);
  });

  it("删除题组会级联删除题目、步骤、讨论、Tag 与详解", async () => {
    const removed = await call<{ ok: true }>(
      running,
      "DELETE",
      "/api/question-groups/g-math",
    );
    expect(removed.status).toBe(200);

    const workspace = await call<WorkspaceData>(running, "GET", "/api/bootstrap");
    expect(workspace.body.groups.map((group) => group.id)).toEqual(["g-calc"]);
    expect(workspace.body.questions.map((question) => question.id).sort()).toEqual([
      "q-inequality",
      "q-limit",
    ]);
    expect(workspace.body.steps).toHaveLength(0);
    expect(workspace.body.subs).toHaveLength(0);
    expect(workspace.body.turns).toHaveLength(0);
    expect(workspace.body.tags).toHaveLength(0);
    expect(workspace.body.explanations).toHaveLength(0);
  });

  it("发送消息会复用同一子讨论并自动关联入口步骤", async () => {
    const first = await call<{
      subConversation: SubConversation;
      turn: ConversationTurn;
      tags: TurnStepTag[];
    }>(running, "POST", "/api/steps/s-quad-1/messages", {
      userMessage: "为什么先配方？",
      assistantMessage: "配方可以直接读出顶点。",
    });
    expect(first.status).toBe(201);
    expect(first.body.tags[0].stepId).toBe("s-quad-1");

    const second = await call<{
      subConversation: SubConversation;
      turn: ConversationTurn;
      tags: TurnStepTag[];
    }>(running, "POST", "/api/steps/s-quad-1/messages", {
      userMessage: "配方后如何确定区间最值？",
      assistantMessage: "比较顶点与端点值。",
    });
    expect(second.status).toBe(201);
    expect(second.body.subConversation.id).toBe(first.body.subConversation.id);

    const conversation = await call<{
      subConversation: SubConversation | null;
      turns: ConversationTurn[];
      tags: TurnStepTag[];
    }>(running, "GET", "/api/steps/s-quad-1/conversation");
    expect(conversation.body.turns).toHaveLength(2);
    expect(conversation.body.tags).toHaveLength(2);

    const workspace = await call<WorkspaceData>(running, "GET", "/api/bootstrap");
    const sub = workspace.body.subs.find((item) => item.id === first.body.subConversation.id);
    expect(sub?.turnIds).toHaveLength(2);

    await call<{ ok: true }>(running, "DELETE", "/api/steps/s-quad-1");
    const afterDelete = await call<WorkspaceData>(running, "GET", "/api/bootstrap");
    expect(afterDelete.body.subs.some((item) => item.id === first.body.subConversation.id)).toBe(
      false,
    );
  });

  it("调整步骤序号不会触发唯一约束冲突", async () => {
    const before = await call<WorkspaceData>(running, "GET", "/api/bootstrap");
    const quadSteps = before.body.steps
      .filter((step) => step.questionId === "q-quad")
      .sort((a, b) => a.order - b.order);
    const target = quadSteps[3];
    expect(target.order).toBe(4);

    const moved = await call<SolutionStep>(
      running,
      "PATCH",
      `/api/steps/${target.id}`,
      { order: 2 },
    );
    expect(moved.status).toBe(200);
    expect(moved.body.order).toBe(2);

    const after = await call<WorkspaceData>(running, "GET", "/api/bootstrap");
    const orders = after.body.steps
      .filter((step) => step.questionId === "q-quad")
      .sort((a, b) => a.order - b.order);
    expect(orders.map((step) => step.order)).toEqual([1, 2, 3, 4, 5]);
    expect(orders[1].id).toBe(target.id);

    const forward = await call<SolutionStep>(
      running,
      "PATCH",
      `/api/steps/${target.id}`,
      { order: 4 },
    );
    expect(forward.status).toBe(200);

    const afterForward = await call<WorkspaceData>(running, "GET", "/api/bootstrap");
    const forwardOrders = afterForward.body.steps
      .filter((step) => step.questionId === "q-quad")
      .sort((a, b) => a.order - b.order);
    expect(forwardOrders.map((step) => step.order)).toEqual([1, 2, 3, 4, 5]);
    expect(forwardOrders[3].id).toBe(target.id);
  });

  it("备份可以导出并以替换方式导入", async () => {
    const backup = await call<BackupPayload>(running, "GET", "/api/backup");
    expect(backup.status).toBe(200);
    expect(backup.body.version).toBe(1);
    expect(backup.body.data.groups).toHaveLength(2);

    await call<{ ok: true }>(running, "DELETE", "/api/question-groups/g-math");
    await call<QuestionGroup>(running, "POST", "/api/question-groups", { title: "临时题组" });

    const imported = await call<WorkspaceData>(running, "POST", "/api/backup/import", backup.body);
    expect(imported.status).toBe(200);
    expect(imported.body.groups).toHaveLength(backup.body.data.groups.length);
    expect(imported.body.explanations).toHaveLength(backup.body.data.explanations.length);
    expect(imported.body.groups.some((group) => group.title === "临时题组")).toBe(false);

    const invalid = await call<{ code: string }>(running, "POST", "/api/backup/import", {
      version: 2,
      data: backup.body.data,
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.code).toBe("INVALID_BACKUP");
  });

  it("无效请求返回明确的业务错误", async () => {
    const missingGroup = await call<{ code: string }>(running, "POST", "/api/questions", {
      groupId: "not-exists",
      content: "题目",
    });
    expect(missingGroup.status).toBe(404);
    expect(missingGroup.body.code).toBe("NOT_FOUND");

    const badMessage = await call<{ code: string }>(
      running,
      "POST",
      "/api/steps/s-quad-1/messages",
      { userMessage: "只有用户消息" },
    );
    expect(badMessage.status).toBe(400);

    const missingStep = await call<{ code: string }>(
      running,
      "GET",
      "/api/steps/not-exists/conversation",
    );
    expect(missingStep.status).toBe(404);
  });
});
