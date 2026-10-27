# Phase 5 — 归档系统 实施计划

## Context

Phase 0–4 已完成并验证：工作台三栏 UI、SQLite 数据层与备份、AI 流式讨论、正式题解生成（含版本 v3）。当前正式答案只能整体重新生成，讨论中的补充与修正无法回到正式内容。

本阶段实现闭环的最后一环：**讨论 → AI 更新提案 → 用户预览确认 → 事务应用 → 版本可比较/可恢复**。验收标准（dev-plan §15 Phase 5）：跨步骤讨论能生成多个步骤的更新提案；未确认的提案绝不修改正式答案。

现状要点：
- 讨论按「入口步骤」1:1 建 sub_conversation；`appendTurn` 已自动写入入口步骤 tag，`conversation_turns.archive_status` 恒为 `unarchived`（尚无写入方）。
- `getChatContext` 只取入口步骤 + 最近 10 轮，不足以支撑归档，需独立 ContextBuilder。
- `replaceSteps(questionId, drafts, createdBy)` 可覆盖步骤并写 revision，可复用于「恢复历史版本」。
- 无 zod，校验统一 `HttpError` + `readXxx`；AI 错误走 `AIError`/`toHttpError`。

## 1. 数据模型（DB v4）

`apps/server/src/db/migrations.ts` 新增 version 4：

```sql
CREATE TABLE archive_proposals (
  id TEXT PRIMARY KEY,
  sub_conversation_id TEXT NOT NULL REFERENCES sub_conversations(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  summary TEXT NOT NULL,
  changes TEXT NOT NULL,          -- JSON: ArchiveChange[]
  source_turn_ids TEXT NOT NULL,  -- JSON: string[]
  created_at INTEGER NOT NULL,
  applied_at INTEGER
);
CREATE INDEX idx_archive_proposals_question ON archive_proposals(question_id, created_at);
```

`replaceWorkspace`（导出/导入）清表时补 `DELETE FROM archive_proposals;`；备份仍不含提案。

## 2. Shared 类型（`packages/shared/src/types.ts`）

- `ArchiveAction = "add_explanation" | "revise_content" | "no_change" | "needs_review"`（对应规格 message 概念，本项目模型为 turn，字段命名 `sourceTurnIds`）。
- `ArchiveChange { stepId; action; proposedContent?; rationale; sourceTurnIds }`
- `ArchiveProposalStatus = "pending" | "applied" | "rejected"`
- `ArchiveProposal { id; subConversationId; questionId; status; summary; changes; sourceTurnIds; createdAt; appliedAt? }`
- `ArchiveApplyResult { steps: SolutionStep[]; revision: SolutionRevision | null; proposal: ArchiveProposal }`（全部 no_change 时不产生新版本）
- `SolutionRevision.createdBy` 扩展为 `"ai" | "manual" | "archive"`（版本历史区分归档来源），同步 `toRevision`/`replaceSteps` 签名。

## 3. Repository（`apps/server/src/repositories/workspace-repository.ts`）

新增：
- `getArchiveContext(subConversationId): ArchiveContextData` — 题目、全部步骤、入口步骤、discussion、**全部** turns、这些 turns 的 tags（含 stepId/来源说明）。讨论不存在 → 404。
- `createArchiveProposal({ subConversationId, questionId, summary, changes, sourceTurnIds })` — 返回 pending 提案；JSON 序列化入库。
- `getArchiveProposal(id)`、`listArchiveProposals(questionId)`（按创建时间倒序）。
- `rejectArchiveProposal(id)` — 仅 pending 可拒绝，否则 409 `PROPOSAL_NOT_PENDING`。
- `applyArchiveProposal(id)` — 事务内完成：
  1. 校验 pending；重新读取题目现行步骤，逐条校验 `stepId` 属于该题，否则 409 `PROPOSAL_CONFLICT`（步骤已被重新生成等）。
  2. `add_explanation`：`现有内容 + "\n\n" + proposedContent`；`revise_content`：替换内容；`no_change` / `needs_review` 跳过。
  3. 更新步骤后读取全量快照，写 revision（`createdBy = "archive"`）；无有效变更则不写 revision。
  4. 提案置 `applied` + `applied_at`；来源 turns 的 `archive_status` 置 `archived`。
  - 返回 `ArchiveApplyResult`；重复 apply → 409。
- `getRevision(questionId, revisionId)` + 路由层调用 `replaceSteps(questionId, revision.steps, "manual")` 实现恢复。

## 4. 归档上下文与生成

新增 `apps/server/src/services/ai/archive-context-builder.ts`：
- `archiveContextToMessages(context): ChatMessage[]`，system prompt 约定只输出 JSON：
  `{"summary":"...","changes":[{"stepId","action","proposedContent?","rationale","sourceTurnIds"}]}`
- user 内容包含：题面、带 ID 的全量步骤正文、入口步骤 ID、讨论轮次（`[turnId] 用户/助手` 全文）与每轮 tag 的 stepId。明确：只能引用给定 ID；`no_change` 不得携带 proposedContent；`add_explanation`/`revise_content` 必须给内容且至少引用 1 个 turn；可返回空 changes。

新增 `apps/server/src/services/ai/archive-generator.ts`（复用 solution-generator 的 `stripCodeFence`、`collectResponse` 思路）：
- `ARCHIVE_TEMPERATURE = 0.2`，解析失败重试 1 次（共 2 次）。
- `parseArchiveProposal(raw): ArchiveProposalDraft`：JSON/结构校验、action 枚举、summary/rationale 非空、`proposedContent` 条件约束、`sourceTurnIds` 字符串数组、`MAX_CHANGES = 20`。
- 引用真实性校验放在路由：`stepId ∈ 题目步骤`、`sourceTurnIds ⊆ 讨论 turns`，失败 → `AIError("INVALID_RESPONSE", ...)` → 502，且不落库。

## 5. API（新增 `apps/server/src/routes/archive.ts`，`app.ts` 挂载）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/discussions/:id/archive` | 生成提案（未配 Key → 400 INVALID_CONFIG；无讨论轮次 → 400 EMPTY_DISCUSSION；生成成功仅落 pending 提案，不动步骤） |
| GET | `/api/questions/:id/archive-proposals` | 查询提案列表 |
| POST | `/api/archive-proposals/:id/apply` | 事务应用 |
| POST | `/api/archive-proposals/:id/reject` | 拒绝 |
| POST | `/api/questions/:id/revisions/:revisionId/restore` | 恢复到历史版本（`routes/solution.ts` 内实现，返回 `SolutionGenerationResult`） |

提案生成流程：校验 Key → `getArchiveContext` → build messages → generator → 引用校验 → `createArchiveProposal` → 201 返回提案。

## 6. 前端

- `apps/web/src/lib/api.ts`：新增 generate/list/apply/reject/restore 方法（复用 `request<T>`、`ApiError`）。
- `apps/web/src/features/workspace/use-workspace.ts`：
  - 状态：`pendingProposal`、`archiveGenerating`、`archiveApplying`、`archiveError`、`archiveDialogOpen`。
  - 题目切换时拉取该题 pending 提案（`api.listArchiveProposals`，取最新 pending）。
  - `generateArchive(subConversationId)`、`applyArchive()`、`rejectArchive()`：成功后 `load()` 刷新工作区（步骤、turn 归档状态）；apply/reject 关闭弹窗。
  - 版本：`revisions` + `loadRevisions()` + `restoreRevision(id)`（确认后 `replaceSteps` 返回，刷新；步骤 ID 会重建，调用 `selectQuestion` 重置 activeStep）。
- `apps/web/src/features/discussions/chat-panel.tsx`：header 增加「归档讨论」按钮（有讨论且非生成中可用），展示 `/归档/` 错误。
- 新增 `apps/web/src/features/archive/archive-proposal-dialog.tsx`（挂在 `workspace-shell.tsx`，仿 `ProviderSettingsDialog` 位置）：
  - 展示 summary；按步骤分组：动作标签、步骤标题、当前内容 vs 提案内容（`add_explanation` 显示「将追加」预览）、rationale、来源轮次摘要（turn 用户/助手各截断一行）。
  - 底部：拒绝 / 确认应用；应用时 loading，失败内联展示（409 冲突提示「步骤已变化，请重新生成提案」）。
- `apps/web/src/features/solutions/solution-panel.tsx`：
  - 存在 pending 提案时显示横条「有 N 项待确认的归档提案」→ 打开弹窗。
  - 分步题解标题右侧增加「版本历史」按钮。
- 新增 `apps/web/src/features/solutions/revision-history-dialog.tsx`：版本列表（序号/时间/来源：AI 生成、手动、归档）、选中版本与当前内容左右对照、内联二次确认「恢复此版本」（提示会重建步骤并删除相关讨论），成功后刷新。

## 7. 测试

- `apps/server/src/services/ai/archive-generator.test.ts`（单测）：合法解析；缺 proposedContent；`no_change` 携带内容；非法 action；空 changes；代码围栏；非法 JSON。
- `apps/server/src/archive.test.ts`（E2E，沿用 `solution.test.ts` 的假上游 + 临时库模式）：
  1. 通过 `POST /steps/s-quad-1/messages` 造多轮讨论，生成提案 → 步骤与 revision 未变、提案 pending。
  2. 应用后：`add_explanation` 追加、`revise_content` 替换、revision `createdBy = "archive"`、来源 turns `archive_status = archived`。
  3. 引用不存在 step/turn → 502 且不落库。
  4. 重复 apply → 409；未配 Key → 400 INVALID_CONFIG；无讨论 → 400 EMPTY_DISCUSSION。
  5. 恢复历史版本 → 步骤回到快照、生成 manual revision。

## 8. 验证

1. `npm run typecheck`、`npm test`、`npm run build` 全部通过。
2. 浏览器（现有 5173/3001 开发服务，临时假 OpenAI SSE 上游）：建测试题组/题目 → 生成题解 → 多步骤讨论 → 归档生成提案 → 检查预览与来源、确认步骤未变 → 应用 → 步骤更新与「已纳入详解」标记 → 版本历史对照 → 恢复版本。
3. 清理：删除测试题组、清空临时 Provider 配置与假上游进程，确认正常数据不受影响。
