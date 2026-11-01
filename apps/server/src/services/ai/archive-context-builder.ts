import type { ChatMessage } from "@motive/shared";
import { resolveSystemPrompt } from "./effective-prompt.js";
import type { ArchiveContextData } from "../../repositories/workspace-repository.js";

export function buildArchiveMessages(
  context: ArchiveContextData,
  options?: { systemPrompt?: string },
): ChatMessage[] {
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
    {
      role: "system",
      content: resolveSystemPrompt("archive_proposal", options?.systemPrompt),
    },
    { role: "user", content: userContent },
  ];
}
