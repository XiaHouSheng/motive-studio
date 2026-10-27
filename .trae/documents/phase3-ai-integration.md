# Phase 3 — AI 接入实施计划

## Context

Phase 0–2 已完成项目骨架、Focus Teal 主题、三栏工作台、SQLite 持久化、CRUD、讨论、Tag、详解与备份导入导出。当前右栏讨论仍由 `mock-reply.ts` 在 900ms 后伪造回复，AI 能力尚未接入。

本阶段只实现「步骤子对话」的真实 AI 流式接入：Provider 设置、API Key 安全存储、OpenAI-compatible SSE 流式对话、独立 ContextBuilder、前端流式发送/停止/重试。正式答案生成与归档提案不在本阶段。

## 目标与约束

- 非敏感 Provider 配置写入 `app_settings`；API Key 只存服务端进程内存，不返回前端、不写日志、不进备份。
- Base URL 默认仅允许 HTTPS，localhost / 127.0.0.1 / ::1 允许 HTTP；前端不能指定任意上游。
- 后端解析上游 SSE 后转换为统一事件，禁止透传供应商原始事件。
- 保留已接收文本；中断/失败标记 `interrupted`；用量仅使用服务商实际返回值。
- 对话上下文严格按 `.agent/prompts/sub-chat.md`：题目全文 + 全部步骤 ID/标题 + 入口步骤全文 + 最近 10 轮 + 新消息，temperature 0.5。

## 实施步骤

### 1. shared 包：类型与 SSE 解析

新增 `packages/shared/src/ai.ts`：

- `ProviderProtocol`、`ProviderConfig`（id/name/baseUrl/model/protocol/temperature?/maxTokens?）。
- `ProviderSettingsView { provider: ProviderConfig; hasApiKey: boolean }`。
- `AIErrorCode`（9 个错误码）。
- `ChatStreamEvent`（text-delta / usage / completed / error）。
- `ChatRole`、`ChatMessage`。

新增 `packages/shared/src/sse.ts`（web/server 共用的纯函数）：

- `createSseParser(): { push(chunk: string): string[]; flush(): string[] }`。
- 正确处理跨 chunk 的 `\r\n`、单独的 `\r`/`\n`、多行 `data:` 合并、注释行、末尾未以空行结束的事件。
- `encodeSseEvent(payload: unknown): string` 统一输出 `data: ...\n\n`。
- `packages/shared/src/index.ts` 增加 `export type * from "./ai"` 与 `export * from "./sse"`。

`packages/shared/src/types.ts`：

- `ConversationTurn` 增加 `generationStatus?: "completed" | "interrupted"`。

### 2. 数据库迁移 v2

修改 `apps/server/src/db/migrations.ts`，追加 version 2：

```sql
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
ALTER TABLE conversation_turns
  ADD COLUMN generation_status TEXT NOT NULL DEFAULT 'completed';
```

`apps/server/src/db/insert-workspace.ts` 导入备份时为 turn 写入 `generationStatus`（缺省 completed）。
备份只包含 `WorkspaceData`，不包含 `app_settings` 与 Key。

### 3. Provider 配置存储与 API

新增 `apps/server/src/services/ai/provider-settings-store.ts`：

- `DEFAULT_PROVIDER_CONFIG`（https://api.openai.com/v1 + gpt-4o-mini）。
- `normalizeBaseUrl(raw): string`：校验协议/主机/无 query/hash，localhost 例外，去尾部斜杠。
- `ProviderSettingsStore(db)`：读取/保存 `app_settings` 中的 `provider_config`；内存 `apiKey`（set/clear/get/has）。
- `getView()` 返回配置 + `hasApiKey`，绝不返回 Key。
- 校验 temperature 0–2、maxTokens 正整数、name/model 非空。

新增 `apps/server/src/routes/settings.ts`：

- `GET /settings/provider` → `ProviderSettingsView`。
- `PUT /settings/provider`：body `{ provider, apiKey?, clearApiKey? }`；apiKey 为空表示保持原 Key；`clearApiKey` 显式清除。
- `POST /settings/provider/test`：使用已保存配置 + 内存 Key，调用一次最小流式请求（maxTokens 8，15s 超时），成功返回 `{ ok, model, latencyMs }`；失败按错误码映射为 HTTP 业务错误。

### 4. OpenAI-compatible Provider

新增 `apps/server/src/services/ai/`：

- `types.ts`：`AIProvider`、`ChatRequest`。
- `errors.ts`：`AIError { code, status? }`。
- `openai-provider.ts`：
  - `streamChat(request, signal)` 异步生成器。
  - POST `${baseUrl}/chat/completions`，body 含 `stream: true`、`stream_options: { include_usage: true }`。
  - 使用 shared `createSseParser` 解析上游，累加 delta、捕获 usage 与 finish_reason。
  - 状态码映射：401/403 → AUTH_FAILED，404 → MODEL_NOT_FOUND，429 → RATE_LIMITED，5xx → PROVIDER_ERROR，其他 4xx → PROVIDER_ERROR；网络异常 → NETWORK_ERROR；JSON 解析失败 → INVALID_RESPONSE；AbortError → CANCELLED。
  - 错误信息截断，绝不输出 Authorization / Key。

### 5. ContextBuilder

新增 `apps/server/src/services/ai/context-builder.ts`：

- `buildChatMessages(input): ChatMessage[]`，输出严格按 sub-chat.md 的 System 与 User 模板；history 为空时写「暂无历史讨论」。
- 不把整个工作区塞入上下文。

`apps/server/src/repositories/workspace-repository.ts`：

- `toTurn` 增加 `generationStatus`。
- `appendTurn` 增加 options：`generationStatus`、`chatUsage`。
- 新增 `getChatContext(stepId, limit = 10)`：返回入口步骤、所属题目、本题全部步骤、最近 10 轮（按 created_at, rowid 排序）。
- `requireStep` 等现有方法与级联行为保持不变。

### 6. 流式消息路由

`apps/server/src/routes/steps.ts` 新增 `POST /steps/:id/messages/stream`：

1. 写 SSE 头之前完成校验：step 存在、userMessage 合法、Provider 已配置 Key；失败返回普通 JSON 400（`INVALID_CONFIG` 等），不混用 SSE。
2. 构造上下文，设置 `text/event-stream`、`no-cache, no-transform`、`X-Accel-Buffering: no`，`flushHeaders()`。
3. `res.on("close")` 且未结束时 abort 上游；使用 `finalized` 布尔防止重复落库。
4. 只累积文本与用量，不逐 delta 落库。
5. 正常：先 `appendTurn(completed, usage)`，再发送 `completed`，最后 `end`。
6. 上游错误：先落库 `interrupted` + 已收文本，再发 `error`（连接仍在时）。
7. 客户端取消 / 断连：落库 `interrupted`，不发送错误事件。
8. 空回复也保留用户消息（assistantMessage 空字符串）。

`apps/server/src/app.ts` 注入 `ProviderSettingsStore` 并挂载 settings 路由。
`apps/server/src/index.ts` 设置 `server.requestTimeout = 0`，避免长流被 300s 掐断。

### 7. 前端 API 与设置界面

`apps/web/src/lib/api.ts`：

- `getProviderSettings`、`saveProviderSettings`、`testProvider`。
- `streamMessage(stepId, userMessage, { signal, onEvent })`：先判 `response.ok` 再读 SSE；复用 shared `createSseParser`；非 2xx 走现有 ApiError 逻辑。

`apps/web/src/stores/ui.ts`：增加 `settingsOpen / openSettings / closeSettings`。

新增 `apps/web/src/components/ui/dialog.tsx`：轻量 overlay（焦点、Escape、点击遮罩关闭，不新增依赖）。
新增 `apps/web/src/features/settings/provider-settings-dialog.tsx`：

- 名称 / Base URL / 模型 / temperature / maxTokens / API Key（password）。
- 「已配置 / 未配置」Badge；已配置时可清除 Key。
- 「保存」与「保存并测试」；测试结果内联展示（成功/失败）。
- 文案说明 Key 只存在本地服务内存、重启需重输、不进入备份。
- 打开时拉取设置；不回显 Key。

`apps/web/src/features/workspace/top-bar.tsx` 增加设置入口图标；`workspace-shell.tsx` 挂载对话框。

### 8. 前端流式状态机

改造 `apps/web/src/features/workspace/use-workspace.ts`：

- 删除 `mock-reply.ts` 调用与 900ms 定时器；删除不再使用的 `mock-reply.ts`。
- 新增按步骤的 `streamingByStep`：`{ userMessage, assistantText, startedAt, status }`，AbortController 存入 ref。
- `sendMessage`：流式接收 text-delta；错误事件设置全局错误；结束后统一 `load()`；取消/失败保留已生成文本并记录可重试消息。
- 新增 `stopGeneration(stepId?)`、`retryFailedSend(stepId?)`、`failedSendByStep`。
- 取消后等待约 120ms 再 reload，规避服务端 close 落库与客户端 fetch reject 的时序竞态。
- `messages` 合并已持久化 turn 与当前流式预览；assistant 消息带 `generationStatus`。

改造 `apps/web/src/features/discussions/chat-panel.tsx`：

- 流式时显示已生成 Markdown + 生成中状态；发送按钮切换为「停止」。
- 失败/取消后显示内联提示，提供「重试」与「模型设置」。
- 「已中断」标记持久化消息。

### 9. 测试

- `apps/server/src/services/ai/sse-parser.test.ts`：1 字节切片、CRLF 跨块、多 data 行、注释、无结束标记、flush。
- `apps/server/src/chat-stream.test.ts`：
  - 用 `node:http` 在随机端口启动假 OpenAI-compatible 上游（正常流 / 401 / 429），不使用 `vi.stubGlobal(fetch)`，避免拦截测试自身请求。
  - settings：默认值、PUT 校验（http 非 localhost 拒绝）、Key 不回传、备份 JSON 不含 Key。
  - 流式：事件顺序 text-delta → usage → completed；落库内容、usage、generationStatus。
  - 错误：401 映射 AUTH_FAILED，保留用户消息与已收文本。
  - 取消：客户端 abort 后轮询会话直到 `interrupted`。
- 现有 12 个测试保持通过。

## 关键文件

- `packages/shared/src/{ai.ts,sse.ts,index.ts,types.ts}`
- `apps/server/src/db/{migrations.ts,insert-workspace.ts}`
- `apps/server/src/repositories/workspace-repository.ts`
- `apps/server/src/services/ai/{provider-settings-store.ts,types.ts,errors.ts,openai-provider.ts,context-builder.ts}`
- `apps/server/src/routes/{settings.ts,steps.ts}`
- `apps/server/src/{app.ts,index.ts}`
- `apps/web/src/lib/api.ts`
- `apps/web/src/stores/ui.ts`
- `apps/web/src/components/ui/dialog.tsx`
- `apps/web/src/features/settings/provider-settings-dialog.tsx`
- `apps/web/src/features/workspace/{use-workspace.ts,top-bar.tsx,workspace-shell.tsx}`
- `apps/web/src/features/discussions/chat-panel.tsx`

## 验证

1. `npm run typecheck` 零错误。
2. `npm test`：web 6 + server 原 6 + 新增 SSE/流式测试全部通过。
3. `npm run build` 成功。
4. 启动本地假上游（127.0.0.1 临时端口），在浏览器中：
   - 打开「模型设置」，默认显示未配置；保存非法 URL 得到明确错误。
   - 保存 `http://127.0.0.1:<port>/v1` + 测试 Key，点击测试连接成功。
   - 在步骤讨论中发送消息，观察逐字流式输出、完成后气泡持久化、无 console 错误。
   - 生成中点击停止，消息标记「已中断」，已生成内容保留。
   - 导出备份，确认不含 API Key 与 Provider 配置。
5. 若用户提供真实 Provider 配置，再用真实 Key 做一次连接与对话验证。

## 不在本阶段范围

- 正式答案生成、解题步骤结构化生成。
- 归档提案生成与应用、版本回滚。
- Key 的磁盘持久化 / 系统凭据库。
- 多 Provider 管理、模型列表拉取。
