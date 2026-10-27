# Motive Studio — 整体开发方案

> 版本：v1.0
> 来源：用户提供的整体开发方案（Master Plan）。
> 配套文档：PRODUCT_SPEC.md（现有 MVP 产品规格）、.agent/ui-ux-plan.md（UI/UX 计划）、.agent/theme-focus-teal.md（Focus Teal 主题）、.agent/prompts/（4 个生产 Prompt）。

产品定位：Local-first AI Workspace（本地优先的 AI 工作台）
当前阶段：个人使用 / 本地开发
核心原则：结构化工作对象 + 自由讨论 + 自动关联 + 可审核归档

---

## 1. 产品愿景与核心定位

Motive Studio 不只是普通聊天界面，也不局限于解题。它以一个可持续维护的结构化工作对象为中心，让用户围绕题目、问题或任务自由讨论，并将讨论中的有价值内容关联回正式结果。

第一阶段重点验证“结构化答案 + 自由讨论 + 自动关联 + 归档更新”的工作流。后续可扩展到代码分析、研究、写作和项目规划。

### 核心交互模型

应用采用三栏工作台：

* 左栏：分组与对象导航 — 管理题目分组、题目列表和当前选择。
* 中栏：正式内容区 — 展示原始题目、结构化答案、步骤和已确认的内容。
* 右栏：自由讨论区 ChatBox — 用户可以连续追问，不必手动选择 Tag 或分类消息。

每条讨论消息的步骤关联由系统自动推断。用户可以从某个步骤进入讨论，该步骤记录为 entryStepId，作为初始定位信号，但不限制后续讨论范围。消息级 messageStepTags 是关联线索，讨论可能同时关联多个步骤。

用户触发归档时，系统综合入口步骤、消息 Tag、原始题目及必要的相邻上下文，为相关步骤生成更新提案。提案经过校验与用户确认后，才更新正式内容。

### 设计原则

1. 讨论过程中允许自然探索，不要求用户频繁切换模式或手动分类。
2. 正式答案与自由讨论分离，避免主内容被聊天淹没。
3. 归档结果必须可追溯、可审核、可撤销。
4. AI 只能提出更新，不能未经确认直接覆盖正式内容。
5. 本地数据优先，暂不实现账号、云同步或多用户协作。

---

## 2. 技术栈

### 前端

| 模块 | 技术 | 职责 |
|---|---|---|
| 框架 | React + TypeScript | 组件化 UI、类型安全 |
| 构建工具 | Vite | 开发服务器与静态构建 |
| 样式 | Tailwind CSS | 布局、响应式与主题 Token |
| UI 组件 | shadcn/ui | 可维护的组件源码与基础设计体系 |
| 无头交互 | Radix UI（按需） | Dialog、Popover、Dropdown 等交互基础 |
| 图标 | Lucide React | 统一图标风格 |
| UI 状态 | Zustand | 当前选择、面板状态、主题等轻量状态 |
| 路由 | React Router | 页面与工作区路由 |
| 数据请求 | TanStack Query（按需） | 请求状态、缓存与重试 |
| 表单 | React Hook Form + Zod（按需） | 表单状态与校验 |
| Markdown | react-markdown | 正式答案与讨论内容渲染 |
| 数学公式 | KaTeX | 数学公式展示 |
| 测试 | Vitest + React Testing Library | 单元与组件测试 |

### 后端

| 模块 | 技术 | 职责 |
|---|---|---|
| 运行环境 | Node.js | 本地服务运行时 |
| HTTP 服务 | Express | 本地 REST API 与流式响应 |
| 数据库 | SQLite | 本地结构化数据持久化 |
| SQLite 驱动 | better-sqlite3 | 轻量同步数据库访问 |
| 数据校验 | Zod | API 请求、响应及 AI 结果校验 |
| 数据访问 | Repository 层 | 隔离 SQL 与业务逻辑 |
| 数据迁移 | 版本化迁移脚本 | 可控地演进表结构 |
| AI 接入 | OpenAI-compatible Provider | 适配兼容 OpenAI API 格式的模型服务 |

### 工程原则

* 单仓库管理前端、后端和共享类型。
* 前后端共享 DTO 与 Zod Schema，减少接口漂移。
* UI 不直接请求第三方模型 API，统一调用本地 Express。
* 领域规则不写进 React 组件或 Express Route。
* 第一版不引入微服务、复杂 ORM 或过早的插件体系。

---

## 3. 整体架构

```
┌──────────────────────────────────────────────┐
│                Motive Studio UI              │
│ React / TypeScript / Tailwind / shadcn/ui    │
└──────────────────────┬───────────────────────┘
                       │ HTTP / SSE
┌──────────────────────▼───────────────────────┐
│                 Express API                  │
│ Routes → Application Services → Domain       │
│                                              │
│ AI Provider / Context Builder / Archive      │
└───────────────┬──────────────────┬───────────┘
                │                  │
       ┌────────▼────────┐  ┌──────▼───────────┐
       │ SQLite Database │  │ External Model API│
       │ Local data      │  │ OpenAI-compatible │
       └─────────────────┘  └──────────────────┘
```

### 分层职责

* Presentation：三栏 UI、输入、状态反馈和交互。
* Application：创建题目、发送消息、生成答案、构造归档提案等用例编排。
* Domain：题目、步骤、讨论、消息、Tag、版本及归档规则。
* Infrastructure：SQLite、AI Provider、HTTP/SSE、文件导入导出。
* Shared：前后端共享的类型、请求/响应 Schema 与错误码。

---

## 4. 项目目录

```
motive-studio/
├── apps/
│   ├── web/
│   │   └── src/
│   │       ├── app/
│   │       ├── components/
│   │       │   ├── ui/
│   │       │   └── shared/
│   │       ├── features/
│   │       │   ├── workspace/
│   │       │   ├── question-groups/
│   │       │   ├── questions/
│   │       │   ├── solutions/
│   │       │   ├── discussions/
│   │       │   ├── archive/
│   │       │   └── settings/
│   │       ├── stores/
│   │       ├── lib/
│   │       └── styles/
│   └── server/
│       └── src/
│           ├── app.ts
│           ├── routes/
│           ├── middleware/
│           ├── services/
│           │   ├── ai/
│           │   ├── context/
│           │   └── archive/
│           ├── repositories/
│           ├── db/
│           │   ├── migrations/
│           │   └── schema/
│           └── config/
├── packages/
│   └── shared/
│       ├── schemas/
│       ├── types/
│       └── errors/
├── data/                    # 运行时数据目录，不提交到 Git
├── scripts/
│   ├── dev.mjs
│   └── start.mjs
├── package.json
├── tsconfig.base.json
├── .gitignore
└── README.md
```

建议采用 npm workspaces。data/、SQLite 文件、日志、密钥和构建产物必须加入 .gitignore。

---

## 5. 核心领域模型

以下是概念模型，具体字段可在实现阶段根据交互需要调整。

### 5.1 QuestionGroup

题目分组，用于左栏组织与导航。

* id
* title
* sortOrder
* createdAt
* updatedAt

### 5.2 Question

代表一个待解决的问题或工作对象。

* id
* groupId（可选，视是否允许未分组题目而定）
* title
* originalContent
* contentType
* createdAt
* updatedAt

### 5.3 Step

正式答案中的一个结构化步骤。

* id
* questionId
* title
* content
* sortOrder
* createdAt
* updatedAt

### 5.4 Discussion

一次围绕某个问题的连续讨论。

* id
* questionId
* entryStepId（可为空，例如从整道题进入）
* status
* createdAt
* updatedAt

entryStepId 记录用户最初从哪里进入讨论，不限制后续内容涉及的步骤。

### 5.5 Message

讨论中的单条消息。

* id
* discussionId
* role（user / assistant / system）
* content
* status（pending / streaming / completed / interrupted / failed / cancelled）
* createdAt
* updatedAt

应允许记录生成尝试状态，避免重试时把新旧回答错误拼接。

### 5.6 MessageStepTag

消息与步骤之间的关联。

* messageId
* stepId
* source（模型推断 / 规则推断 / 用户修正等）
* confidence（可选）
* createdAt

单条消息可以关联多个步骤。Tag 是相关性线索，不应被当作绝对正确的标签。

### 5.7 SolutionRevision

正式答案的版本记录。

* id
* questionId
* revisionNumber
* snapshot
* createdAt
* createdBy（用户 / AI 提案确认等）

### 5.8 ArchiveProposal

归档产生的可审核变更提案。

* id
* discussionId
* status（pending / approved / rejected / applied）
* proposalJson
* sourceMessageIds
* createdAt
* appliedAt（可选）

提案必须保留来源消息与目标步骤，便于解释每项修改的依据。

---

## 6. SQLite 数据与一致性

第一版建议至少创建以下表：

* question_groups
* questions
* steps
* discussions
* messages
* message_step_tags
* solution_revisions
* archive_proposals
* app_settings

### 数据库约束

1. 使用稳定 ID（例如 UUID）。
2. 为关联字段建立外键并启用 SQLite foreign keys。
3. 对常用查询字段建立索引，如 groupId、questionId、discussionId、createdAt。
4. 所有 SQL 使用参数化查询。
5. 数据结构变更通过迁移脚本完成，不在每次启动时重建数据库。
6. 归档应用在事务中完成，避免部分更新。
7. 保留正式答案快照或版本记录，支持差异比较和回滚。
8. 提供数据库备份与数据导入导出能力。

### 设置与密钥

* 非敏感配置（Provider 名称、Base URL、模型名、生成参数）可以存入 app_settings。
* API Key 不返回给前端，不写入日志或导出文件。
* MVP 优先将 Key 保存在服务端进程内存中，重启后重新输入。
* 后续如需持久保存，优先评估系统凭据库；不要默认将明文 Key 存入 SQLite。
* 前端设置页仅显示“已配置 / 未配置”，不得回显完整密钥。

---

## 7. AI Provider 接入

### 7.1 设计原则

前端只调用本地 Express API。Express 内部通过统一的 AIProvider 接口请求外部模型服务。

第一版仅支持兼容 OpenAI Chat Completions 格式的 Provider，避免同时维护多种协议。

### 7.2 Provider 配置

```ts
export type ProviderConfig = {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  protocol: "openai-chat-completions";
  temperature?: number;
  maxTokens?: number;
};
```

密钥应独立存储，不放在普通 Provider 配置对象中持久化或返回给前端。

### 7.3 核心接口

```ts
export interface AIProvider {
  streamChat(
    request: ChatRequest,
    signal?: AbortSignal
  ): AsyncIterable<ChatStreamEvent>;
  generateSolution(
    request: SolutionRequest,
    signal?: AbortSignal
  ): Promise<SolutionResult>;
  createArchiveProposal(
    request: ArchiveRequest,
    signal?: AbortSignal
  ): Promise<ArchiveProposal>;
}
```

### 7.4 SSE 流式事件

统一业务层事件：

```ts
type ChatStreamEvent =
  | { type: "text-delta"; text: string }
  | { type: "usage"; inputTokens?: number; outputTokens?: number }
  | { type: "completed"; finishReason?: string }
  | { type: "error"; code: string; message: string };
```

要求：

* 后端解析上游 SSE，并将其转换为稳定的内部事件格式。
* 不把供应商原始事件直接透传给 UI。
* 支持取消生成，使用 AbortController 中止上游请求。
* 处理跨 chunk 的不完整 SSE 行、异常断流和结束标记。
* 保留已接收文本；中断时标记为 interrupted。
* 记录用量时仅使用服务商实际返回的数据。

---

## 8. 上下文构造策略

上下文构造应独立为 ContextBuilder，不放在 React 组件或路由中。

### 8.1 普通讨论

根据当前任务构造最小必要上下文：

1. 原始题目与必要元数据。
2. 讨论入口 entryStepId。
3. 最近的必要对话历史。
4. 入口步骤及必要的相关步骤内容。
5. 当前用户消息。

不默认发送整个工作区的所有题目和历史讨论。

### 8.2 归档讨论

归档时使用更完整的上下文：

1. 原始题目。
2. 入口步骤 entryStepId。
3. 当前讨论的相关消息。
4. messageStepTags 及其来源、置信度（如有）。
5. 正式答案当前版本及步骤内容。
6. 为理解上下文所必需的相邻消息或相邻步骤。

### 8.3 Tag 处理原则

* 入口步骤是初始定位信号，不是讨论范围限制。
* 消息 Tag 可能不完整或不准确。
* 跨步骤消息可以关联多个步骤。
* 同一消息被多个步骤引用时保留统一消息 ID，避免来源丢失。
* 标签不确定时可让归档模型辅助判断，但不得因此丢弃原始消息。
* 归档结果必须携带来源消息 ID。

---

## 9. 正式答案与归档流程

### 正式答案生成

1. 用户创建题目或提交原始内容。
2. 后端构造题目上下文并调用 AI。
3. 解析结构化答案。
4. 校验 Schema 和必要业务规则。
5. 保存题目步骤与初始版本。
6. 前端展示正式答案。

### 归档更新

1. 用户主动触发归档。
2. 后端读取当前讨论、入口步骤、消息 Tag 和正式答案。
3. ContextBuilder 为各相关步骤构造上下文。
4. AI 生成结构化 ArchiveProposal。
5. 服务端执行 JSON Schema / Zod 校验。
6. 校验目标步骤与来源消息是否真实存在。
7. 前端展示变更预览与来源依据。
8. 用户确认后，后端在数据库事务中应用变更并保存新版本。
9. 保留旧版本，允许查看差异与回滚。

### 归档 Schema 示例

```ts
import { z } from "zod";

export const ArchiveProposalSchema = z.object({
  discussionId: z.string(),
  changes: z.array(
    z.object({
      stepId: z.string(),
      action: z.enum([
        "add_explanation",
        "revise_content",
        "no_change",
        "needs_review",
      ]),
      proposedContent: z.string().optional(),
      rationale: z.string(),
      sourceMessageIds: z.array(z.string()),
    })
  ),
  summary: z.string(),
});
```

实际实现时应根据 action 细化条件约束：需要新增或修改内容时要求 proposedContent；no_change 不应产生修改内容。所有 ID 必须再经过数据库存在性与所属关系校验。

模型输出结构合法并不代表内容正确。必须保留人工确认步骤。

---

## 10. API 设计

第一版可采用以下接口：

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | /api/health | 本地服务健康检查 |
| GET / PUT | /api/settings/provider | 读取或修改非敏感 Provider 配置 |
| POST | /api/settings/provider/test | 测试模型连接 |
| GET / POST | /api/question-groups | 查询 / 创建分组 |
| GET / POST | /api/questions | 查询 / 创建题目 |
| GET / PATCH / DELETE | /api/questions/:id | 获取 / 修改 / 删除题目 |
| GET / POST | /api/questions/:id/discussions | 查询 / 创建讨论 |
| GET | /api/discussions/:id/messages | 查询消息历史 |
| POST | /api/discussions/:id/stream | 发送消息并流式返回 AI 回复 |
| POST | /api/questions/:id/solution/generate | 生成正式答案 |
| POST | /api/discussions/:id/archive | 生成归档提案 |
| POST | /api/archive-proposals/:id/apply | 确认应用归档提案 |
| GET | /api/questions/:id/revisions | 查询正式答案历史版本 |

具体接口可以随 UI 交互调整，但 API 的请求与响应应通过共享 Zod Schema 管理。

---

## 11. 错误处理

统一定义业务错误码：

```ts
type AIErrorCode =
  | "INVALID_CONFIG"
  | "AUTH_FAILED"
  | "RATE_LIMITED"
  | "NETWORK_ERROR"
  | "PROVIDER_ERROR"
  | "MODEL_NOT_FOUND"
  | "INVALID_RESPONSE"
  | "SCHEMA_VALIDATION_FAILED"
  | "CANCELLED";
```

处理策略：

* 401 / 403：提示检查密钥和权限，不无限重试。
* 429：优先遵循 Retry-After，否则有限次指数退避。
* 5xx：允许有限次数重试。
* 网络中断：保存已收到的文本，标记为 interrupted。
* 用户取消：终止请求，不当作系统错误。
* 结构化结果无效：不得应用，可进行有限次数重试或让用户重新生成。
* 数据库保存失败：保留已生成内容并允许再次保存。
* 日志：不得输出 API Key、Authorization Header 或完整敏感配置。

前端需要显示可理解的错误提示，并提供重试或修改配置的入口。

---

## 12. Focus Teal 主题系统

支持三种外观模式：

* Light：固定日间模式。
* Dark：固定夜间模式。
* System：跟随操作系统。

主题使用语义化 CSS Variables 管理。切换主题不能重置工作区或业务状态。

### 日间模式

| Token | 颜色 |
|---|---|
| 品牌深色 | #173C3B |
| 品牌主色 | #0D9488 |
| 主色悬停 | #0B7F75 |
| 辅助强调 | #5CC7B6 |
| 选中底色 | #E5F6F2 |
| 页面背景 | #F7FAF9 |
| 侧栏背景 | #F0F5F3 |
| 面板背景 | #FFFFFF |
| 主文字 | #202A28 |
| 次级文字 | #64716D |
| 辅助文字 | #8A9691 |
| 边框 | #DDE7E3 |

### 夜间模式

| Token | 颜色 |
|---|---|
| 品牌深色 | #102927 |
| 品牌主色 | #2DD4BF |
| 主色悬停 | #5EEAD4 |
| 辅助强调 | #5EEAD4 |
| 选中底色 | #173C38 |
| 页面背景 | #111817 |
| 侧栏背景 | #151F1D |
| 面板背景 | #192321 |
| 浮层背景 | #202D2A |
| 主文字 | #E5EFEC |
| 次级文字 | #A0B0AA |
| 辅助文字 | #74857F |
| 边框 | #2D3D38 |

### 视觉规则

* 品牌色主要用于主要操作、选中步骤、焦点状态和少量强调。
* 左栏保持中性，正式内容区优先保证阅读体验，ChatBox 使用轻微背景差异区分消息。
* 夜间模式避免纯黑大面积背景。
* 适配 Markdown、代码、公式、表格、弹窗、输入框、滚动条和所有交互状态。
* 不使用大面积霓虹、强渐变或无意义装饰。

---

## 13. 一键启动与构建

使用 npm workspaces 管理 apps/web、apps/server 和 packages/shared。

根目录脚本示例：

```json
{
  "scripts": {
    "dev": "concurrently -k -n web,server \"npm run dev:web\" \"npm run dev:server\"",
    "dev:web": "npm --prefix apps/web run dev",
    "dev:server": "npm --prefix apps/server run dev",
    "build": "npm run build --prefix apps/web && npm run build --prefix apps/server",
    "start": "node scripts/start.mjs"
  }
}
```

开发启动：

```
npm install
npm run dev
```

生产构建与启动：

```
npm run build
npm start
```

### 启动器职责

* 检查 Node.js 版本。
* 创建运行时数据目录。
* 执行数据库迁移。
* 启动 Express。
* 在开发模式下由 Vite 提供前端开发服务。
* 在生产模式下由 Express 托管前端构建产物。
* 检查端口占用并输出清楚的错误信息。
* 不得在启动时清空或重建现有数据库。

第一版的“一键启动”是本地 Node.js 环境下的一条命令。若未来希望用户无需安装 Node.js，可再考虑打包成桌面应用。

---

## 14. 安全边界

即使是个人本地应用，也必须遵循以下规则：

1. Express 默认只监听 127.0.0.1。
2. 生产模式限制 Origin，避免开放任意跨域访问。
3. 对自定义 Provider Base URL 做校验，默认仅允许 HTTPS；本地开发环境可允许 localhost。
4. 不允许前端随意指定任意上游 URL，避免本地服务被滥用访问内网资源。
5. API Key 不进入前端、不写日志、不包含在导出文件中。
6. SQLite 所有 SQL 使用参数化查询。
7. 归档操作使用事务，并检查步骤、消息和题目之间的所属关系。
8. 对 AI 输出进行结构化校验，未经用户确认不得覆盖正式答案。
9. 本地数据库应支持备份和恢复。
10. 如果未来公开部署或支持多用户，重新设计身份验证、授权、密钥存储和请求限流，不直接沿用个人本地模式。

---

## 15. 分阶段实施计划

### Phase 0 — 工程骨架

* 建立 npm workspaces。
* 初始化 Vite、React、TypeScript、Tailwind、shadcn/ui。
* 初始化 Express 与共享类型包。
* 配置代码规范、测试和构建。
* 建立 Focus Teal 主题及 Light / Dark / System 切换。

验收： 项目可构建，前后端能通过一条命令启动。

### Phase 1 — 工作台 UI

* 三栏布局。
* 分组与题目导航。
* 正式答案和步骤展示。
* ChatBox 消息列表与输入框。
* 空状态、加载、错误和响应式适配。

验收： 使用模拟数据可以完整演示工作台交互。

### Phase 2 — 数据层

* SQLite Schema 和迁移。
* Repository 层与 API 基础 CRUD。
* 题目、步骤、讨论、消息的持久化。
* 备份与导入导出。

验收： 刷新或重启后，数据仍可恢复。

### Phase 3 — AI 接入

* Provider 设置和连接测试。
* API Key 内存管理。
* OpenAI-compatible 请求适配。
* SSE 流式讨论、取消和错误处理。
* 消息历史保存。

验收： 用户能通过自己的 Key 与真实模型连续对话。

### Phase 4 — 正式答案生成

* Solution Prompt。
* 结构化答案 Schema。
* 解析与业务校验。
* 初始答案和步骤版本保存。

验收： AI 生成的答案能可靠转换为正式步骤结构。

### Phase 5 — 归档系统

* ContextBuilder。
* 入口步骤和消息 Tag 参与上下文组织。
* 结构化 ArchiveProposal。
* 来源追溯、差异预览和用户确认。
* 事务应用、版本比较和撤销。

验收： 跨步骤讨论可以生成多个步骤的更新提案；未确认的提案不会修改正式答案。

### Phase 6 — 稳定性与发布准备

* Provider 兼容性测试。
* 断网、限流、错误 JSON、取消和重试测试。
* 数据库备份恢复。
* 密钥与日志检查。
* 一键启动和生产构建验证。

验收： 核心工作流可重复使用，关键失败路径均有明确反馈和恢复办法。

---

## 16. 测试策略

### 单元测试

* ContextBuilder 的上下文选择与消息去重。
* MessageStepTag 的多步骤关联。
* ArchiveProposal Schema 与业务规则。
* 归档版本应用、回滚和冲突检查。
* Provider SSE 解析器对跨 chunk 数据的处理。

### 集成测试

* Express API 与 SQLite Repository。
* AI Provider 的成功、错误、限流和断流。
* 归档提案从生成到应用的完整流程。
* 数据迁移和备份恢复。

### 手工验收

1. 新建分组与题目。
2. 生成正式答案。
3. 从某个步骤进入讨论。
4. 讨论内容自然跨越多个步骤。
5. 触发归档并预览提案。
6. 确认后检查步骤更新与版本历史。
7. 重启应用并验证数据仍存在。
8. 测试停止生成、错误重试和无效密钥。
9. 切换日间 / 夜间模式，确认业务状态不受影响。

---

## 17. 第一版明确不做的事情

* 云端后端部署。
* 账号注册、登录和多用户权限。
* 云同步与协作编辑。
* 微服务与分布式任务队列。
* 复杂插件系统。
* 直接公开开发者自己的 API Key。
* 未经确认的自动覆盖式归档。
* 为未来可能的功能提前引入过多抽象。

未来可扩展方向包括桌面打包、用户自定义 Provider、云同步、更多 AI 能力以及代码分析、研究和项目规划场景。

---

## 18. 最终技术决策摘要

* 产品形态： 本地优先的 AI 工作台。
* 前端： React + TypeScript + Vite。
* 样式与组件： Tailwind CSS + shadcn/ui + Radix UI（按需）。
* 后端： Node.js + Express。
* 数据库： SQLite + better-sqlite3。
* 共享契约： TypeScript + Zod。
* AI： OpenAI-compatible Provider，后端统一代理。
* 流式输出： 服务端解析上游 SSE，向前端输出统一事件。
* 本地启动： npm workspaces + 一条命令启动。
* 数据策略： 本地持久化、可备份、可导入导出。
* 核心业务： 结构化答案、自由讨论、自动关联、可审核归档。
* 安全策略： Key 不返回浏览器、不写日志；服务默认仅监听本机。
* 实施顺序： 工程骨架 → UI → 数据层 → AI 讨论 → 正式答案 → 归档 → 稳定性。

核心原则：先把本地单用户闭环做好，再扩展部署形态和能力。
