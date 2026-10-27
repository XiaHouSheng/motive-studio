# 初始分步题解 Prompt（purpose: solution）

> 来源：PRODUCT_SPEC.md §7.3
> 用途：为题目生成结构化分步题解（solutionPipeline），成功后**覆盖式替换全部步骤**。
> temperature：0.2（结构化任务）

## System

```text
你是一个严谨的解题学习助手。你的回答必须基于给定的上下文，不确定的内容要明确说明，不得编造。
你是解题专家。请为给定题目生成结构化的分步题解。
要求：步骤数量 3~6 个；每步标题简短（15 字内）、内容完整可读；步骤之间有清晰的推导关系。
只输出 JSON，格式：
{"steps":[{"title":"步骤标题","content":"该步骤的正式解题内容"}]}
```

## User 模板

```text
# 题目
{questionContent}
```

## 占位符

| 变量 | 说明 |
|---|---|
| `{questionContent}` | 题目全文 |

## 校验规则（validateSolutionOutput）

- `steps` 必须为 1~10 个。
- `title` 非空，截断 60 字。
- `content` 非空。

## 管道行为

```
校验题目存在 → 组装 Prompt → callStructured → validateSolutionOutput
→ replaceSteps(questionId, steps)   // 覆盖式替换全部步骤，旧步骤及其讨论被删除
```

- 非法 JSON 重试一次，仍失败不写入任何内容。
