# Motive Studio 扩展方案：题目图片与 AI 多模态上下文

> 状态：已按当前代码库收敛为 MVP 实施版。原方案的分期目标保留，但删除与本仓库现状不符或首版无法验收的部分（自动切题、OCR 引擎选型、图片缓存、图片区域坐标）。

## 1. 目标与范围

### 1.1 问题

题目图片常承载文字之外的必要条件：手写公式、上下标、几何图、函数图像、网络拓扑、电路图、表格。当前实现只有纯文本题目：

- `questions` 表只有 `content`（`apps/server/src/db/migrations.ts` v1），上传的图片在识别成文本后即被丢弃。
- 题解生成 `buildSolutionMessages(questionContent)` 只传文本，模型看不到原图。
- 桌面端没有任何原图入口，用户无法核对 OCR 结果。

### 1.2 本次实施范围（MVP）

1. 图片资源落盘 + 元数据入库，图片与题目多对多关联（一张整页图可被多题引用）。
2. 手机端提交时把本次上传的原图一并保存并关联到新建/追加的题目。
3. 题解生成统一走 `QuestionContextBuilder`：按「题目图片策略 + 模型视觉能力」决定是否附原图。
4. 桌面端题目区展示原图缩略图，可切换图片策略（`auto` / `always` / `never`）。
5. 每次 AI 请求记录素材快照（用了哪些图片、为什么）。
6. Provider 配置显式声明是否支持视觉输入。

### 1.3 本次不做（保留为后续迭代）

- OCR 引擎接入与置信度、OCR 文本修订、OCR 与题干差异对比。
- 自动切题、手动框选区域、裁剪派生资源、归一化坐标。
- 缩略图生成、图片压缩、去重命中复用、图片/OCR 缓存。
- 讨论与归档的图片上下文（本次只接题解生成；讨论/归档下一阶段接入同一构建器）。
- 图片区域引用、图片标注。

### 1.4 设计原则

1. 原图是证据，长期保存；文本是可修订的派生资料。
2. 所有 AI 业务通过同一条上下文构建路径取素材，不在业务里散落拼装逻辑。
3. 没有视觉能力的模型不得静默丢图后给出确定答案，必须告警或拒绝。
4. 不把图片 Base64 存进 SQLite；SQLite 只存路径与元数据。
5. 服务端生成文件名，不信任客户端文件名；读取图片走鉴权接口，不暴露主机路径。

---

## 2. 数据模型

迁移版本 5，追加到 `apps/server/src/db/migrations.ts`。

```sql
CREATE TABLE assets (
  id TEXT PRIMARY KEY,              -- 服务端生成的 UUID
  storage_path TEXT NOT NULL,      -- 相对 data/uploads 的路径，如 originals/xx.png
  mime_type TEXT NOT NULL,         -- image/png | image/jpeg | image/webp
  file_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  width INTEGER,                   -- 首版可为 NULL
  height INTEGER,
  status TEXT NOT NULL DEFAULT 'ready',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_assets_sha256 ON assets(sha256);

CREATE TABLE question_assets (
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'original',   -- original | crop | reference
  created_at INTEGER NOT NULL,
  PRIMARY KEY (question_id, asset_id)
);
CREATE INDEX idx_question_assets_question ON question_assets(question_id, position);

ALTER TABLE questions ADD COLUMN image_policy TEXT NOT NULL DEFAULT 'auto';

CREATE TABLE ai_context_snapshots (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL,
  task_type TEXT NOT NULL,          -- solution_generation
  image_policy TEXT NOT NULL,
  included_asset_ids TEXT NOT NULL, -- JSON 数组
  selection_reason TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_ai_context_snapshots_question
  ON ai_context_snapshots(question_id, created_at);
```

不建 `ocr_text` 等字段：本次无 OCR 链路，先不引入永远为空的列。

---

## 3. 存储与安全

- 目录：`data/uploads/originals/`，启动时按需创建，路径来自 `config.ts` 新增的 `UPLOADS_DIR`（`path.resolve(here, "../../data/uploads")` 附近，与 `DB_FILE` 同级推导）。
- 文件名：`randomUUID()` + 根据嗅探类型定的扩展名。
- 大小与数量：单张 ≤ 6MB（与现有 `MAX_IMAGE_BYTES` 一致）、单次 ≤ 4 张、单题关联上限 8 张。
- 类型校验：不信任 `mediaType`，读取文件头签名（PNG `89 50 4E 47`、JPEG `FF D8 FF`、WebP `RIFF....WEBP`），与声明类型不一致即拒绝。
- 读取接口只返回二进制流，不返回 `storage_path`；桌面端通过 `/api/assets/:id` 访问，仅允许回环请求（复用 `routes/mobile.ts` 的 loopback 判定，抽成公共函数）。
- 删除：`DELETE /api/questions/:id/assets/:assetId` 只解除关联；当某 asset 已无任何 `question_assets` 引用时才删除数据库行与磁盘文件。

---

## 4. API 契约

| 方法与路径 | 请求 | 响应 |
|---|---|---|
| `POST /api/questions/:id/assets` | `{ images: [{ mediaType, data }] }`（`data` 为不含前缀的 base64） | `201 { assets: QuestionAsset[] }` |
| `GET /api/questions/:id/assets` | — | `{ assets: QuestionAsset[] }` |
| `DELETE /api/questions/:id/assets/:assetId` | — | `{ ok: true }`（解绑；无引用时删文件） |
| `GET /api/assets/:assetId` | — | 二进制图片，`Cache-Control: no-store`，仅回环 |
| `PATCH /api/questions/:id/image-policy` | `{ imagePolicy: "auto" \| "always" \| "never" }` | `{ question }` |

`QuestionAsset`（`packages/shared/src/types.ts`）：

```ts
export type ImagePolicy = "auto" | "always" | "never";

export interface QuestionAsset {
  id: ID;
  mimeType: string;
  fileSize: number;
  createdAt: number;
  /** 浏览器可用的读取地址：/api/assets/<id> */
  url: string;
}
```

`Question` 增加 `imagePolicy: ImagePolicy` 与 `assets: QuestionAsset[]`（bootstrap 组装时填充）。

移动端 `POST /api/mobile/commit` 请求体增加可选 `images: [{ mediaType, data }]`：先建题，再把图片保存为 assets 并按顺序关联到本次新建的每道题（同一张整页图关联到该次提交的所有新题）。

---

## 5. `QuestionContextBuilder`

新增 `apps/server/src/services/ai/question-context.ts`，签名：

```ts
interface BuildContextInput {
  questionId: string;
  taskType: "solution_generation";
  provider: { supportsVision: boolean; model: string };
}

interface BuiltContext {
  messages: ChatMessage[];      // 含 system/user，user 内可含 image_url 分片
  includedAssetIds: string[];
  imagePolicy: ImagePolicy;
  reasons: string[];
  warnings: string[];
}
```

选择规则（确定性，不做模型判断）：

| 条件 | 行为 |
|---|---|
| 无关联图片 | 纯文本，reason `no_assets` |
| `image_policy = never` | 纯文本，reason `policy_never` |
| `image_policy = always` 且模型无视觉能力 | 抛 `HttpError(400, "VISION_UNSUPPORTED", "当前模型不支持图片输入，请更换模型或在题目设置中改用 auto")` |
| `image_policy = always` | 传全部图片（最多 4 张，按 position） |
| `image_policy = auto` 且模型有视觉能力 | 有图就传（最多 4 张），reason `auto_has_assets` |
| `image_policy = auto` 且模型无视觉能力 | 纯文本 + warning `vision_unsupported_fallback` |

图片以 data URL（`data:<mime>;base64,<data>`）进入消息，和 `image-import-generator.ts` 现有做法一致，由 `openai-provider` 原样转发。

每次构建后写 `ai_context_snapshots`（题目、任务、策略、实际图片 ID、原因、模型）。快照写入失败只打日志，不阻断题解生成。

---

## 6. Provider 能力

- `ProviderConfig` 增加 `supportsVision: boolean`（默认 `true`，兼容服务多数是多模态模型；显式可关）。
- 设置弹窗增加「支持图片输入」开关；服务商预设同步设置该值（DeepSeek/Kimi 关，通义千问/智谱/OpenAI 开）。
- 页首提示：关闭后 `always` 策略会报错，`auto` 会降级为纯文本。

---

## 7. 改动清单

### 服务端

1. `apps/server/src/db/migrations.ts`：新增 v5 迁移（见第 2 节）。
2. `apps/server/src/config.ts`：新增 `UPLOADS_DIR`。
3. `apps/server/src/services/asset-store.ts`（新建）：`sniffImageType`、`saveImage(mediaType, data)`、`readImage(asset)`、`removeImage(asset)`。
4. `apps/server/src/repositories/workspace-repository.ts`：`createAssetsForQuestion`、`associateAssets`、`listQuestionAssets`、`deleteQuestionAsset`、`pruneOrphanAssets`、`setQuestionImagePolicy`、`recordContextSnapshot`、`getQuestionForContext`；`toQuestion` 填充 `imagePolicy`/`assets`。
5. `apps/server/src/routes/question-assets.ts`（新建）：第 4 节前四个端点 + `GET /api/assets/:id`。
6. `apps/server/src/routes/questions.ts`：新增 `PATCH /questions/:id/image-policy`。
7. `apps/server/src/routes/mobile.ts`：`commit` 接受 `images` 并落盘关联。
8. `apps/server/src/mobile/page.ts`：提交时带上 `state.images`。
9. `apps/server/src/services/ai/question-context.ts`（新建）：上下文构建（第 5 节）。
10. `apps/server/src/services/ai/solution-generator.ts`：改为接受已构建的 `messages`（保留 `buildSolutionMessages` 供纯文本调用/测试）。
11. `apps/server/src/routes/solution.ts`：生成前调用构建器，传 `messages`；记录快照。
12. `apps/server/src/app.ts`：挂载 `question-assets` 路由；`config` 校验 `UPLOADS_DIR` 目录存在。
13. `packages/shared/src/types.ts`：`ImagePolicy`、`QuestionAsset`、`Question.imagePolicy`/`assets`、`ProviderConfig.supportsVision`。

### 桌面端

14. `apps/web/src/lib/api.ts`：`listQuestionAssets`、`uploadQuestionAssets`、`deleteQuestionAsset`、`setQuestionImagePolicy`。
15. `apps/web/src/features/solutions/solution-panel.tsx`：题目区展示图片缩略图（点击放大，复用 `Dialog`）与策略下拉（三档），`always` 且模型无视觉时显示警示条。
16. `apps/web/src/features/settings/provider-settings-dialog.tsx`：增加「支持图片输入」开关，预设带默认值。
17. `apps/web/src/features/workspace/use-workspace.ts`：策略切换、删除图片的状态与动作，成功后 `load()` 刷新。

### 测试

18. `apps/server/src/assets.test.ts`（新建）：
    - 上传 2 张 PNG → 201，`GET` 返回 2 条，磁盘存在文件；
    - 非法 base64 / 伪造 mediaType（声明 png 实为 jpeg）/ 超量 5 张 → 400；
    - 删除关联后 `GET` 为空，磁盘文件被清理；
    - `PATCH image-policy` 非法值 400，合法值回写并出现在 bootstrap。
19. `apps/server/src/solution-context.test.ts`（新建）：假上游捕获请求体：
    - `never` → 无 `image_url` 分片；
    - `always` + 有视觉 → 有 `image_url` 且 `data:image/png;base64,...`；
    - `always` + 无视觉 → 400 `VISION_UNSUPPORTED`；
    - `auto` + 无视觉 → 200 且无图片、快照记录降级原因。
20. `apps/server/src/mobile.test.ts`：`commit` 带 `images` 时创建题目并关联图片。

---

## 8. 验收标准

- 手机拍照导入后，桌面端题目区能看到原图；重启服务后仍可查看。
- 同一程序内重复提交同一张图不会产生重复文件（按 sha256 复用已存在 asset）。
- `never` 下题解请求无图片分片，原图仍保留。
- `always` 下模型不支持视觉时明确报错，不静默降级。
- `auto` 下有图且有视觉能力时附带图片，快照可追溯。
- 删除某题的最后一张图会清理磁盘文件；其他题目仍引用时不清理。
- `npm run typecheck`、`npm test`、`npm run build` 全绿。
