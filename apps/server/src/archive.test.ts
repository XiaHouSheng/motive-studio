import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type {
  ArchiveApplyResult,
  ArchiveProposal,
  ProviderSettingsView,
  SolutionGenerationResult,
  SolutionRevision,
  WorkspaceData,
} from "@motive/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const DISCUSSION_ID = "sub-quad-2";
const QUESTION_ID = "q-quad";

const PROPOSAL = JSON.stringify({
  summary: "补充端点比较的说明，并重写最值步骤",
  changes: [
    {
      stepId: "s-quad-2",
      action: "add_explanation",
      proposedContent: "补：闭区间上的最值要同时检查顶点与两个端点。",
      rationale: "讨论中解释了候选值的来源",
      sourceTurnIds: ["t-1"],
    },
    {
      stepId: "s-quad-5",
      action: "revise_content",
      proposedContent: "最大值需要比较顶点与两端的函数值后确定。",
      rationale: "讨论指出不能默认取右端点",
      sourceTurnIds: ["t-1"],
    },
  ],
});

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
      apiKey: "sk-test-archive",
    }),
  });
  expect(response.status).toBe(200);
  expect(((await response.json()) as ProviderSettingsView).hasApiKey).toBe(true);
}

async function bootstrap(app: RunningApp): Promise<WorkspaceData> {
  const response = await fetch(`${app.baseUrl}/api/bootstrap`);
  return (await response.json()) as WorkspaceData;
}

async function generateProposal(app: RunningApp): Promise<Response> {
  return fetch(`${app.baseUrl}/api/discussions/${DISCUSSION_ID}/archive`, {
    method: "POST",
  });
}

async function listProposals(app: RunningApp): Promise<ArchiveProposal[]> {
  const response = await fetch(
    `${app.baseUrl}/api/questions/${QUESTION_ID}/archive-proposals`,
  );
  return (await response.json()) as ArchiveProposal[];
}

function summarizeProposal(app: RunningApp, proposalId: string, action: string) {
  return fetch(`${app.baseUrl}/api/archive-proposals/${proposalId}/${action}`, {
    method: "POST",
  });
}

async function listRevisions(app: RunningApp): Promise<SolutionRevision[]> {
  const response = await fetch(
    `${app.baseUrl}/api/questions/${QUESTION_ID}/revisions`,
  );
  return (await response.json()) as SolutionRevision[];
}

let workDir: string;
let apps: RunningApp[] = [];
let upstreams: RunningUpstream[] = [];

beforeEach(() => {
  workDir = mkdtempSync(path.join(tmpdir(), "motive-archive-"));
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

describe("归档提案生成", () => {
  it("生成提案时不改动步骤、不写版本", async () => {
    const { app, upstream } = await setup(() => PROPOSAL);
    const before = await bootstrap(app);
    const beforeStep2 = before.steps.find((step) => step.id === "s-quad-2");
    if (!beforeStep2) throw new Error("缺少种子步骤");

    const response = await generateProposal(app);
    expect(response.status).toBe(201);
    const proposal = (await response.json()) as ArchiveProposal;

    expect(proposal.status).toBe("pending");
    expect(proposal.questionId).toBe(QUESTION_ID);
    expect(proposal.subConversationId).toBe(DISCUSSION_ID);
    expect(proposal.changes).toHaveLength(2);
    expect(proposal.sourceTurnIds).toEqual(["t-1"]);
    expect(proposal.appliedAt).toBeUndefined();

    const after = await bootstrap(app);
    expect(after.steps.find((step) => step.id === "s-quad-2")?.content).toBe(
      beforeStep2.content,
    );
    expect(await listRevisions(app)).toHaveLength(0);

    const body = upstream.bodies[0] as {
      model: string;
      temperature: number;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe("test-model");
    expect(body.temperature).toBe(0.2);
    expect(body.messages[0].content).toContain("只输出 JSON");
    expect(body.messages[1].content).toContain("[s-quad-2]");
    expect(body.messages[1].content).toContain("为什么一定要比较端点和顶点的值");
    expect(body.messages[1].content).toContain("[t-1]");
  });

  it("引用不存在的步骤时返回 502 且不落库", async () => {
    const invalid = JSON.stringify({
      summary: "错误的提案",
      changes: [
        {
          stepId: "s-missing",
          action: "revise_content",
          proposedContent: "内容",
          rationale: "依据",
          sourceTurnIds: ["t-1"],
        },
      ],
    });
    const { app } = await setup(() => invalid);

    const response = await generateProposal(app);
    expect(response.status).toBe(502);
    expect(((await response.json()) as { code: string }).code).toBe("INVALID_RESPONSE");
    expect(await listProposals(app)).toHaveLength(0);
  });

  it("引用不存在的讨论轮次时返回 502 且不落库", async () => {
    const invalid = JSON.stringify({
      summary: "错误的提案",
      changes: [
        {
          stepId: "s-quad-2",
          action: "add_explanation",
          proposedContent: "内容",
          rationale: "依据",
          sourceTurnIds: ["t-missing"],
        },
      ],
    });
    const { app } = await setup(() => invalid);

    const response = await generateProposal(app);
    expect(response.status).toBe(502);
    expect(await listProposals(app)).toHaveLength(0);
  });

  it("未配置 API Key 时返回 400", async () => {
    const app = await startApp(path.join(workDir, "nokey.db"));
    apps.push(app);

    const response = await generateProposal(app);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { code: string }).code).toBe("INVALID_CONFIG");
  });
});

describe("归档提案应用", () => {
  it("应用后更新步骤、写入归档版本并标记来源轮次", async () => {
    const { app } = await setup(() => PROPOSAL);
    const before = await bootstrap(app);
    const beforeStep2 = before.steps.find((step) => step.id === "s-quad-2");
    if (!beforeStep2) throw new Error("缺少种子步骤");

    const proposal = (await (await generateProposal(app)).json()) as ArchiveProposal;
    const response = await summarizeProposal(app, proposal.id, "apply");
    expect(response.status).toBe(200);
    const result = (await response.json()) as ArchiveApplyResult;

    expect(result.proposal.status).toBe("applied");
    expect(result.revision).not.toBeNull();
    expect(result.revision?.createdBy).toBe("archive");
    expect(result.revision?.revisionNumber).toBe(1);

    const step2 = result.steps.find((step) => step.id === "s-quad-2");
    expect(step2?.content).toBe(
      `${beforeStep2.content}\n\n补：闭区间上的最值要同时检查顶点与两个端点。`,
    );
    expect(result.steps.find((step) => step.id === "s-quad-5")?.content).toBe(
      "最大值需要比较顶点与两端的函数值后确定。",
    );

    const after = await bootstrap(app);
    expect(after.turns.find((turn) => turn.id === "t-1")?.archiveStatus).toBe("archived");

    const revisions = await listRevisions(app);
    expect(revisions).toHaveLength(1);
    expect(revisions[0].createdBy).toBe("archive");

    const again = await summarizeProposal(app, proposal.id, "apply");
    expect(again.status).toBe(409);
    expect(((await again.json()) as { code: string }).code).toBe("PROPOSAL_NOT_PENDING");
  });

  it("拒绝提案后步骤不变且无法再应用", async () => {
    const { app } = await setup(() => PROPOSAL);
    const before = await bootstrap(app);
    const proposal = (await (await generateProposal(app)).json()) as ArchiveProposal;

    const rejected = await summarizeProposal(app, proposal.id, "reject");
    expect(rejected.status).toBe(200);
    expect(((await rejected.json()) as ArchiveProposal).status).toBe("rejected");

    const after = await bootstrap(app);
    expect(after.steps.find((step) => step.id === "s-quad-2")?.content).toBe(
      before.steps.find((step) => step.id === "s-quad-2")?.content,
    );
    expect(await listRevisions(app)).toHaveLength(0);

    const apply = await summarizeProposal(app, proposal.id, "apply");
    expect(apply.status).toBe(409);
  });
});

describe("历史版本恢复", () => {
  it("恢复归档版本时重建步骤并写入手动版本", async () => {
    const { app } = await setup(() => PROPOSAL);
    const proposal = (await (await generateProposal(app)).json()) as ArchiveProposal;
    const applied = (await (
      await summarizeProposal(app, proposal.id, "apply")
    ).json()) as ArchiveApplyResult;
    const firstRevision = applied.revision;
    if (!firstRevision) throw new Error("应用后应产生版本");

    const response = await fetch(
      `${app.baseUrl}/api/questions/${QUESTION_ID}/revisions/${firstRevision.id}/restore`,
      { method: "POST" },
    );
    expect(response.status).toBe(200);
    const restored = (await response.json()) as SolutionGenerationResult;

    expect(restored.revision.createdBy).toBe("manual");
    expect(restored.revision.revisionNumber).toBe(2);
    expect(restored.steps.map((step) => step.content)).toEqual(
      firstRevision.steps.map((step) => step.content),
    );

    const after = await bootstrap(app);
    expect(after.subs.some((sub) => sub.id === DISCUSSION_ID)).toBe(false);

    const revisions = await listRevisions(app);
    expect(revisions.map((revision) => revision.createdBy)).toEqual([
      "manual",
      "archive",
    ]);
  });
});
