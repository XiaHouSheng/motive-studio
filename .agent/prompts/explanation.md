# 题目级详解 Prompt（purpose: archiving）· 核心

> 来源：PRODUCT_SPEC.md §7.4 + §8.3/8.4
> 用途：把分步解答与用户讨论融合为一份连贯的题目级 Markdown 详解（explanationPipeline）。
> 一次请求生成整题详解（不是每步一个请求）。
> temperature：0.2（结构化任务）

## System

```text
你是一个严谨的解题学习助手。你的回答必须基于给定的上下文，不确定的内容要明确说明，不得编造。
你是解题详解撰写者。请基于题目的分步解答与用户在讨论中不懂的地方，输出一份**完整的题目详解**（Markdown）。
写作规则：
1. 结构以步骤为顺序（使用 ## 标题，保留步骤的先后逻辑），读起来是一篇连贯的详解文章，而不是步骤原文的拼接。
2. 每个步骤下：先完整讲解该步的推理与依据；融入该步骤关联讨论时，**必须先以整行粗体单独点出用户的原始问题**（如单独一行 `**问：为什么 (x-2)²≥0 就能推出 f(x)≥-1？**`），随后另起段落给出解答——不得出现与任何讨论无关的凭空补充。不得以问答罗列的形式呈现。
3. 已确认的修正落实到行文；尚未验证的推测在对应步骤末尾以"> ⚠️ 待验证：…"单独标注，不得当作结论陈述。
4. 讨论中被否定的方案不得作为有效方法写入（可注明"讨论中曾提出的 X 方案被否定，因为……"）。
5. 未关联步骤的讨论若对整体有价值，融入最合适的位置并同样点出原始问题。
6. 推导中的**关键公式必须单独成行并用反引号包裹**（如一行只写 `f(x) = (x-3)² - 4`），使其渲染为独立的公式块；行内提及的符号用行内代码。不使用 LaTeX。
只输出 JSON，格式：{"explanation":"完整 Markdown 详解","summary":"一句话概述本详解"}
```

## User 模板

```text
# 题目
{questionContent}

# 分步解答与各步骤关联讨论
### 步骤「{stepTitle}」（{stepId}）
{stepContent}
关联讨论：
  - 【轮次 {turnId}】用户：{userMessage} / 助手：{assistantMessage}
  - 【轮次 {turnId}·关联】用户曾问：{userMessage 前 40 字}…（该讨论全文见步骤「{primaryStepTitle}」，如与本步骤相关请参考）
  （或：本步骤暂无关联讨论）
...

# 未关联步骤的讨论
  - 【轮次 {turnId}】用户：{userMessage} / 助手：{assistantMessage}
  （或：（无））
```

## 上下文组装规则（§8.3）

1. **快照**：取该题所有 Sub 下 `archiveStatus === 'unarchived'` 的轮次，按 `createdAt` 升序固定。
2. **轮次 → 主步骤**：
   - 收集该轮的全部 Tag 步骤（限本题步骤）。
   - 主步骤 = 若入口步骤在该轮 Tag 中则取入口步骤，否则取第一个 Tag 步骤。
   - 其余 Tag 步骤为「次要关联」。
3. **组装**：
   - 主步骤挂**全文** `userMessage + assistantMessage`。
   - 次要关联步骤只挂 **refOnly 摘要**：`userMessage.slice(0, 40)` + 指向主步骤标题的指引，不重复全文。
   - 无任何 Tag 的轮次放入「未关联步骤的讨论」区，避免遗漏。
4. 完成后：把这些轮次标记 `archiveStatus = 'archived'`；新讨论可再次生成新版详解。

> refOnly 是关键的 Token 优化：同一轮讨论若被多个步骤 Tag，全文只出现一次，避免跨步骤重复计入。

## 输出校验（validateExplanationOutput，§8.4）

```ts
validateExplanationOutput(raw):
  explanation 必须是字符串且 trim 后 ≥ 20 字 → content = trim().slice(0, 30000)
  summary 可选，字符串则 slice(0, 300)
  否则返回 null（触发一次格式重试）
```

## 管道行为（§9.4）

```
1. 防重：题目存在、无 processing 任务、至少 1 个步骤
2. 快照未纳入轮次；为 0 时报「没有可纳入的讨论（或尚未完成步骤关联标记）」
3. buildTaggedStepGroups（refOnly 优化）+ 未关联轮次
4. 创建 explanation 记录（processing + promptLog 估算）
5. callStructured(purpose: 'archiving', validateExplanationOutput)
   ├─ 失败 → status = failed + errorMessage（UI 可重试）
   └─ 成功 → content / summary / completed / usage；turnIds 标记 archived
6. flush()
```

## 设计要点（产品 IP）

- **以步骤为叙事骨架**：输出是文章，不是步骤原文 + 问答附录。
- **强制点出原始问题**：用整行粗体触发 Markdown 的「问题强调块」，保证用户能看到「这是对我疑问的回答」。
- **待验证与已否定隔离**：推测只能进引用块，被否定方案不能当有效方法。
- **公式渲染约定**：整行反引号 → 独立公式块，避免 LaTeX 依赖。
- 详解**不修改** `SolutionStep.content`；正式题解不被讨论污染。
