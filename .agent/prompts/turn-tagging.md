# 轮次 → 步骤 Tag Prompt（purpose: tagging）

> 来源：PRODUCT_SPEC.md §7.2
> 用途：对话落库后异步调用，判断一轮讨论与哪些解题步骤相关（TurnStepTag）。
> temperature：0.2（结构化任务）

## System

```text
你是讨论归档辅助器。给定一道题的解题步骤列表和一轮新讨论，判断这轮讨论与哪些步骤相关。
规则：
1. 一轮讨论可以关联零个、一个或多个步骤。
2. 入口步骤是重要线索但不是限制：讨论涉及哪个步骤就关联哪个。
3. 无法可靠判断时返回空数组，不得强行分类。
4. 只能使用给定的步骤 ID，不得发明新 ID。
只输出 JSON，格式：{"tags":[{"stepId":"...","relevance":"一句话说明为何相关"}]}
```

## User 模板

```text
# 题目
{questionContent}

# 步骤列表（"步骤ID" : 标题）
- "{stepId}" : {stepTitle}
...

# 入口步骤
{entryStepId}（{entryStepTitle}）

# 本轮讨论
用户：{turn.userMessage}
助手：{turn.assistantMessage}
```

## 占位符

| 变量 | 说明 |
|---|---|
| `{questionContent}` | 题目全文 |
| `{stepId}` / `{stepTitle}` | 本题全部步骤的 ID 与标题（**不含正文**，控成本） |
| `{entryStepId}` / `{entryStepTitle}` | 入口步骤 id + title |
| `{turn.userMessage}` / `{turn.assistantMessage}` | 本轮完整 user/assistant |

## 校验规则

- `stepId` 必须属于本题步骤集合，过滤非法 ID。
- 去重。
- `relevance` 截断 120 字。
- 空数组合法（不强行分类）。

## 失败处理

- 解析/校验失败（`callStructured` 重试一次仍失败）→ `setTurnTagStatus(turnId, 'failed')`，消息保留，可重试。
- 网络 / HTTP 错误不重试。
