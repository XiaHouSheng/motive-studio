# Phase 4 — 正式答案生成

## Context

Phase 0–3 已完成：工作台、SQLite 数据层、OpenAI 兼容 SSE 对话。当前题目只能手动创建步骤，`SolutionPanel` 空态仅提示“尚未生成正式题解”。

Phase 4 的目标是让用户基于题目一键生成结构化分步题解：调用模型输出严格 JSON，经解析与业务校验后**覆盖式替换**全部步骤，并保存初始答案快照（步骤版本），为 Phase 5 的归档/撤销打基础。失败时不写入任何内容，前端给出明确错误与恢复入口。

## 设计要点

- 非流式请求：`POST /api/questions/:id/solution/generate` 等服务端聚合完整输出后返回，避免前端处理结构化流式增量。
- 非法 JSON 或校验失败时**重试一次**；两次都失败返回 502 `INVALID_RESPONSE`，不改动现有步骤。
- 生成成功即覆盖全部旧步骤（旧步骤的讨论随外键级联删除），并写入一条 `solution_revisions` 快照。
- 版本记录不进入备份 `WorkspaceData`，导入备份时一并清空。

## 改动清单

### 1. shared 类型

文件：[types.ts](file:///d:/Xia_Project/AgentWorkSHeet/motive-studio/packages/shared/src/types.ts)

新增：

- `SolutionStepDraft { title: string; content: string }`
- `SolutionRevision { id; questionId; revisionNumber; steps: SolutionStepDraft[]; createdAt; createdBy: "ai" | "manual" }`
- `SolutionGenerationResult { steps: SolutionStep[]; revision: SolutionRevision }`

### 2. 数据库 v3 迁移

文件：[migrations.ts](file:///d:/Xia_Project/AgentWorkSHeet/motive-studio/apps/server/src/db/migrations.ts)

追加 `version: 3`：

```sql
CREATE TABLE solution_revisions (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL,
  steps TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  UNIQUE (question_id, revision_number)
);
CREATE INDEX idx_solution_revisions_question
  ON solution_revisions(question_id, revision_number);
```

### 3. Repository

文件：[workspace-repository.ts](file:///d:/Xia_Project/AgentWorkSHeet/motive-studio/apps/server/src/repositories/workspace-repository.ts)

- 新增 `getQuestion(questionId): Question`（复用私有 `requireQuestion` + `toQuestion`）。
- 新增 `replaceSteps(questionId, drafts: SolutionStepDraft[], createdBy = "ai"): SolutionGenerationResult`：
  - `withTransaction` 内：删除该题全部 `solution_steps`（级联清理 subs/turns/tags）→ 按顺序插入新步骤 → 计算 `MAX(revision_number)+1` 写入快照（`JSON.stringify(drafts)`）→ 更新 `questions.updated_at`。
  - 返回新步骤与 revision。
- 新增 `listRevisions(questionId): SolutionRevision[]`，按 `revision_number DESC`。
- `replaceWorkspace` 的清空语句中补充 `DELETE FROM solution_revisions;`。
- 新增 Row / 映射函数（`RevisionRow`、`toRevision`、`toDraft`）。

### 4. Solution Prompt 与生成器

新文件：`apps/server/src/services/ai/solution-generator.ts`

- 常量 `SOLUTION_TEMPERATURE = 0.2`，System 文案与 [solution.md](file:///d:/Xia_Project/AgentWorkSHeet/motive-studio/.agent/prompts/solution.md) 一致；User 仅 `# 题目\n{questionContent}`。
- `buildSolutionMessages(questionContent): ChatMessage[]`。
- `parseSolutionDraft(raw): SolutionStepDraft[]`：去除 ```json 围栏 → `JSON.parse` → 校验：
  - `steps` 为数组且 1–10 条；
  - `title`/`content` 为非空字符串；`title` 截断 60 字；
  - 非法时抛 `AIError("INVALID_RESPONSE", ...)`。
- `generateSolution(provider, questionContent, signal?)`：调用 `provider.streamChat` 聚合 `text-delta`；解析失败则再试一次（最多 2 次）；事件 `error` 转为 `AIError`。

### 5. 路由与挂载

新文件：`apps/server/src/routes/solution.ts`

- `POST /questions/:id/solution/generate`
  - 未配置 Key → 400 `INVALID_CONFIG`（与其他 AI 路由文案一致）。
  - 校验题目存在 → 组装消息 → 生成 → `repository.replaceSteps` → 201 返回 `SolutionGenerationResult`。
  - 失败统一 `toHttpError`；应用 `res close` 时 abort 上游（沿用 steps 路由的 settled 守卫）。
- `GET /questions/:id/revisions` → `repository.listRevisions`。

文件：[app.ts](file:///d:/Xia_Project/AgentWorkSHeet/motive-studio/apps/server/src/app.ts)：挂载 `createSolutionRouter(repository, settingsStore)`。

### 6. 前端 API 与状态

- [api.ts](file:///d:/Xia_Project/AgentWorkSHeet/motive-studio/apps/web/src/lib/api.ts)：新增 `generateSolution(questionId): Promise<SolutionGenerationResult>`。
- [use-workspace.ts](file:///d:/Xia_Project/AgentWorkSHeet/motive-studio/apps/web/src/features/workspace/use-workspace.ts)：
  - 新增 `generatingSolution: boolean`、`solutionError: { message: string; code?: string } | null`。
  - `generateSolution()`：取当前题目 → 调 API → 成功后 `selectQuestion(id)` 清理失效的 activeStepId → `load()`；失败写入内联错误（不占用全局 error 横幅）。
  - 导出上述字段与动作。

### 7. SolutionPanel 交互

文件：[solution-panel.tsx](file:///d:/Xia_Project/AgentWorkSHeet/motive-studio/apps/web/src/features/solutions/solution-panel.tsx)

- 空态：保留 `EmptyState`，其下增加主按钮「生成分步题解」；生成中显示 `Loader2` +「正在生成题解…」并禁用。
- 已有步骤：区块标题右侧 `secondary` 小按钮「重新生成」；点击弹 `Dialog` 二次确认，文案说明会覆盖 N 个步骤并删除其讨论；确认后调用生成。
- 内联错误条（`AlertCircle`）：展示 `solutionError.message`；当 `code === "INVALID_CONFIG"` 时附「配置模型」按钮，调用 `useUiStore.openSettings()`。

### 8. 测试

新文件：

- `apps/server/src/services/ai/solution-generator.test.ts`：解析 ```json 围栏、非法 JSON、steps 数量边界（0/11）、空标题/内容、标题截断 60。
- `apps/server/src/solution.test.ts`（复用 chat-stream.test 的假上游/E2E 写法）：
  - 成功生成：上游收到 system/user 与 `temperature: 0.2`；步骤被覆盖（旧 step id 消失、数量正确）；`GET /revisions` 返回 revision 1。
  - 首次非法 JSON、第二次合法 → 重试成功。
  - 两次非法 → 502 且现有步骤保持不变。
  - 未配置 Key → 400 `INVALID_CONFIG`。

## 验证

1. `npm run typecheck`、`npm test`、`npm run build`。
2. 重启本地服务，浏览器打开工作台：未配置 Key 时点生成 → 内联错误与「配置模型」入口；配置本地假上游后生成 → 步骤覆盖、讨论清空、重新生成需确认。
3. 验证后清理测试数据与 Provider 配置，恢复默认未配置 Key 状态。
