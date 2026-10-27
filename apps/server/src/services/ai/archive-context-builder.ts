import type { ChatMessage } from "@motive/shared";
import type { ArchiveContextData } from "../../repositories/workspace-repository.js";

const SYSTEM_PROMPT = `你是一个严谨的解题归档助手。你的任务是把一段围绕题目展开的讨论，整理成对正式题解的更新提案。
要求：
1. 只依据给定材料提炼，不得编造讨论中不存在的事实。
2. 只能引用提供的「步骤 ID」和「讨论轮次 ID」，不得虚构 ID。
3. 只有讨论确实带来新增理解或修正时才提议修改；无变化或证据不足时使用 no_change / needs_review。
4. add_explanation 只写需要追加的补充说明，不要重复步骤原文；revise_content 重写整段步骤内容。
5. add_explanation / revise_content 必须至少引用 1 个讨论轮次 ID。
6. 用中文，适度使用 Markdown。
只输出 JSON，格式：
{"summary":"提案概述","changes":[{"stepId":"步骤ID","action":"add_explanation|revise_content|no_change|needs_review","proposedContent":"要写入的内容（no_change 与 needs_review 省略此字段）","rationale":"修改依据","sourceTurnIds":["讨论轮次ID"]}]}`;

export function buildArchiveMessages(context: ArchiveContextData): ChatMessage[] {
  const stepContent = context.steps
    .map(
      (step) =>
        `## [${step.id}] ${step.order}. ${step.title}\n${step.content}`,
    )
    .join("\n\n");

  const stepIdsByTurn = new Map<string, string[]>();
  for (const tag of context.tags) {
    const list = stepIdsByTurn.get(tag.turnId) ?? [];
    list.push(tag.stepId);
    stepIdsByTurn.set(tag.turnId, list);
  }

  const turnContent =
    context.turns.length === 0
      ? "暂无讨论记录"
      : context.turns
          .map((turn) => {
            const tagged = stepIdsByTurn.get(turn.id) ?? [];
            const tagLine =
              tagged.length > 0 ? `（关联步骤：${tagged.join(", ")}）` : "（未关联步骤）";
            return `[${turn.id}]${tagLine}\n用户：${turn.userMessage}\n助手：${turn.assistantMessage}`;
          })
          .join("\n\n");

  const userContent = `# 题目
${context.question.content}

# 正式题解步骤（[步骤ID] 序号. 标题）
${stepContent}

# 讨论入口步骤
[${context.entryStep.id}] ${context.entryStep.order}. ${context.entryStep.title}

# 讨论记录（[讨论轮次ID]）
${turnContent}`;

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];
}
