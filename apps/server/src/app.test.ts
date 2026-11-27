import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type {
  BackupPayload,
  PaperGroup,
  Question,
  QuestionGroup,
  SolutionGenerationResult,
  SolutionRevision,
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
  const app = createApp({ dbPath, uploadsDir: path.join(path.dirname(dbPath), "uploads") });
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

  it("手动编辑步骤写入 manual 快照并可恢复", async () => {
    const before = await call<WorkspaceData>(running, "GET", "/api/bootstrap");
    const target = before.body.steps.find((step) => step.id === "s-quad-2");
    expect(target).toBeDefined();
    expect(target?.content).not.toBe("手动修正后的步骤内容。");

    const patched = await call<SolutionStep>(running, "PATCH", "/api/steps/s-quad-2", {
      content: "手动修正后的步骤内容。",
    });
    expect(patched.status).toBe(200);
    expect(patched.body.content).toBe("手动修正后的步骤内容。");

    // 步骤更新与 manual 快照原子落库：快照内容反映编辑后的全部步骤
    const revisions = await call<SolutionRevision[]>(
      running,
      "GET",
      "/api/questions/q-quad/revisions",
    );
    expect(revisions.status).toBe(200);
    const manual = revisions.body
      .filter((revision) => revision.createdBy === "manual")
      .sort((a, b) => b.revisionNumber - a.revisionNumber)[0];
    expect(manual).toBeDefined();
    const snapshotDraft = manual.steps.find((draft) => draft.title === target?.title);
    expect(snapshotDraft?.content).toBe("手动修正后的步骤内容。");

    // 快照可恢复：步骤内容回到快照记录的状态
    const restored = await call<SolutionGenerationResult>(
      running,
      "POST",
      `/api/questions/q-quad/revisions/${manual.id}/restore`,
    );
    expect(restored.status).toBe(200);
    const restoredStep = restored.body.steps.find((step) => step.title === target?.title);
    expect(restoredStep?.content).toBe("手动修正后的步骤内容。");
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

  it("备份可携带图片导出，导入后还原题目图片", async () => {
    // 1×1 PNG
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const attached = await call<{ assets: Array<{ id: string }> }>(
      running,
      "POST",
      "/api/questions/q-quad/assets",
      { images: [{ mediaType: "image/png", data: pngBase64 }] },
    );
    expect(attached.status).toBe(201);
    const assetId = attached.body.assets[0]?.id;
    expect(assetId).toBeTruthy();

    // 默认导出不带图片，勾选后内嵌图片
    const plain = await call<BackupPayload>(running, "GET", "/api/backup");
    expect(plain.status).toBe(200);
    expect(plain.body.images).toBeUndefined();

    const withImages = await call<BackupPayload>(running, "GET", "/api/backup?images=1");
    expect(withImages.status).toBe(200);
    expect(withImages.body.images).toHaveLength(1);
    expect(withImages.body.images?.[0]?.id).toBe(assetId);
    expect(withImages.body.images?.[0]?.data).toBe(pngBase64);

    // 删除题目后用带图片的备份整体还原
    const deleted = await call<{ ok: true }>(running, "DELETE", "/api/questions/q-quad");
    expect(deleted.status).toBe(200);
    const imported = await call<WorkspaceData>(
      running,
      "POST",
      "/api/backup/import",
      withImages.body,
    );
    expect(imported.status).toBe(200);

    // 关联顺序与资源 id 与备份一致
    const restored = await call<{ assets: Array<{ id: string }> }>(
      running,
      "GET",
      "/api/questions/q-quad/assets",
    );
    expect(restored.status).toBe(200);
    expect(restored.body.assets.map((asset) => asset.id)).toEqual([assetId]);

    // 图片二进制已落盘还原：资源接口可读回同样的字节
    const image = await fetch(`${running.baseUrl}/api/assets/${assetId}`);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await image.arrayBuffer()).toString("base64")).toBe(pngBase64);

    // 不带 images 的旧备份也能导入（图片关联会被清空，但不报错）
    const legacyImport = await call<WorkspaceData>(running, "POST", "/api/backup/import", plain.body);
    expect(legacyImport.status).toBe(200);
    const afterLegacy = await call<{ assets: Array<{ id: string }> }>(
      running,
      "GET",
      "/api/questions/q-quad/assets",
    );
    expect(afterLegacy.status).toBe(200);
    expect(afterLegacy.body.assets).toHaveLength(0);
  });

  it("备份可携带讨论图片导出，导入后还原轮次附图关联", async () => {
    // 1×1 PNG
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const db = running.app.locals.db as DatabaseSync;
    const now = Date.now();
    // 直接构造轮次与附图关联（流式生成需要上游模型，数据层测试用 SQL 造数）
    db.exec(`
      INSERT INTO sub_conversations (id, entry_step_id, created_at, updated_at)
      VALUES ('sub-t1', 's-quad-1', ${now}, ${now});
      INSERT INTO conversation_turns (id, sub_conversation_id, user_message, assistant_message, created_at, tag_status, generation_status)
      VALUES ('turn-t1', 'sub-t1', '看图提问', '图示回复', ${now}, 'tagged', 'completed');
      INSERT INTO assets (id, storage_path, mime_type, file_size, sha256, status, created_at)
      VALUES ('asset-t1', 'originals/turn-t1.png', 'image/png', 70, 'sha-turn-t1', 'ready', ${now});
      INSERT INTO turn_assets (turn_id, asset_id, position, created_at)
      VALUES ('turn-t1', 'asset-t1', 0, ${now});
    `);
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const uploadsDir = path.join(path.dirname(dbPath), "uploads");
    mkdirSync(path.join(uploadsDir, "originals"), { recursive: true });
    writeFileSync(path.join(uploadsDir, "originals", "turn-t1.png"), Buffer.from(pngBase64, "base64"));

    const withImages = await call<BackupPayload>(running, "GET", "/api/backup?images=1");
    expect(withImages.status).toBe(200);
    expect(withImages.body.images?.some((image) => image.id === "asset-t1")).toBe(true);
    const exportedTurn = withImages.body.data.turns.find((turn) => turn.id === "turn-t1");
    expect(exportedTurn?.images?.[0]?.assetId).toBe("asset-t1");

    // 整体替换导入后轮次附图关联与原图字节都恢复
    const imported = await call<WorkspaceData>(running, "POST", "/api/backup/import", withImages.body);
    expect(imported.status).toBe(200);
    const restoredTurn = imported.body.turns.find((turn) => turn.id === "turn-t1");
    expect(restoredTurn?.images?.[0]?.assetId).toBe("asset-t1");
    const image = await fetch(`${running.baseUrl}/api/assets/asset-t1`);
    expect(image.status).toBe(200);
    expect(Buffer.from(await image.arrayBuffer()).toString("base64")).toBe(pngBase64);

    // 不带 images 的旧备份也能导入：轮次关联缺失但不报错
    const plain = await call<BackupPayload>(running, "GET", "/api/backup");
    const legacyImport = await call<WorkspaceData>(running, "POST", "/api/backup/import", plain.body);
    expect(legacyImport.status).toBe(200);
    const legacyTurn = legacyImport.body.turns.find((turn) => turn.id === "turn-t1");
    expect(legacyTurn?.images).toBeUndefined();
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

  it("删除试卷分组时其中的题目一并删除，题组允许没有试卷分组", async () => {
    const group = await call<QuestionGroup>(running, "POST", "/api/question-groups", {
      title: "试卷删除测试",
    });
    expect(group.status).toBe(201);
    const papersOfGroup = (data: WorkspaceData) =>
      (data.paperGroups ?? []).filter((paper) => paper.groupId === group.body.id);

    // 新建题组自带一个默认试卷；再建一张试卷并各放一道题
    const bootstrap = await call<WorkspaceData>(running, "GET", "/api/bootstrap");
    const defaultPaper = papersOfGroup(bootstrap.body)[0];
    expect(defaultPaper).toBeDefined();
    const second = await call<PaperGroup>(
      running,
      "POST",
      `/api/question-groups/${group.body.id}/paper-groups`,
      { title: "第二张试卷" },
    );
    expect(second.status).toBe(201);
    const q1 = await call<Question>(running, "POST", "/api/questions", {
      groupId: group.body.id,
      content: "默认试卷的题目",
      paperGroupId: defaultPaper.id,
    });
    const q2 = await call<Question>(running, "POST", "/api/questions", {
      groupId: group.body.id,
      content: "第二张试卷的题目",
      paperGroupId: second.body.id,
    });
    expect(q1.status).toBe(201);
    expect(q2.status).toBe(201);

    // 删除默认试卷：题目不转移，随试卷一起删除
    const removed = await call<{ ok: true }>(
      running,
      "DELETE",
      `/api/paper-groups/${defaultPaper.id}`,
    );
    expect(removed.status).toBe(200);
    let data = (await call<WorkspaceData>(running, "GET", "/api/bootstrap")).body;
    expect(papersOfGroup(data).map((paper) => paper.id)).toEqual([second.body.id]);
    const questionIds = data.questions.map((question) => question.id);
    expect(questionIds).not.toContain(q1.body.id);
    expect(questionIds).toContain(q2.body.id);

    // 只剩一张试卷也允许删除：题组保留但没有任何试卷分组
    const removedLast = await call<{ ok: true }>(
      running,
      "DELETE",
      `/api/paper-groups/${second.body.id}`,
    );
    expect(removedLast.status).toBe(200);
    data = (await call<WorkspaceData>(running, "GET", "/api/bootstrap")).body;
    expect(papersOfGroup(data)).toHaveLength(0);
    expect(data.groups.find((item) => item.id === group.body.id)).toBeDefined();

    // 之后在空题组新建题目时自动补建默认试卷
    const q3 = await call<Question>(running, "POST", "/api/questions", {
      groupId: group.body.id,
      content: "空题组新题目",
    });
    expect(q3.status).toBe(201);
    data = (await call<WorkspaceData>(running, "GET", "/api/bootstrap")).body;
    const rebuilt = papersOfGroup(data);
    expect(rebuilt).toHaveLength(1);
    expect(rebuilt[0].title).toBe("默认试卷");
    expect(q3.body.paperGroupId).toBe(rebuilt[0].id);
  });
});
