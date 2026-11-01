import type { ChatMessage } from "@motive/shared";
import { resolveSystemPrompt } from "./effective-prompt.js";
import type { ExplanationContextData } from "../../repositories/workspace-repository.js";

const REF_ONLY_LENGTH = 40;

export function buildExplanationMessages(
  context: ExplanationContextData,
  options?: { systemPrompt?: string },
): ChatMessage[] {
  const steps = context.steps;
  const stepById = new Map(steps.map((step) => [step.id, step]));

  // 轮次 → 关联步骤；首个关联步骤视为主步骤（挂全文），其余仅挂摘要
  const stepIdsByTurn = new Map<string, string[]>();
  for (const tag of context.tags) {
    if (!stepById.has(tag.stepId)) continue;
    const list = stepIdsByTurn.get(tag.turnId) ?? [];
    if (!list.includes(tag.stepId)) list.push(tag.stepId);
    stepIdsByTurn.set(tag.turnId, list);
  }

  const sections = steps.map((step) => {
    const lines: string[] = [];
    for (const turn of context.turns) {
      const tagged = stepIdsByTurn.get(turn.id) ?? [];
      if (tagged.length === 0) continue;
      const primaryStepId = tagged[0];
      if (primaryStepId === step.id) {
        lines.push(
          `  - 【轮次 ${turn.id}】用户：${turn.userMessage}\n    助手：${turn.assistantMessage}`,
        );
      } else if (tagged.includes(step.id)) {
        const primaryTitle = stepById.get(primaryStepId)?.title ?? "其他步骤";
        lines.push(
          `  - 【轮次 ${turn.id}·关联】用户曾问：${turn.userMessage.slice(0, REF_ONLY_LENGTH)}…（该讨论全文见步骤「${primaryTitle}」，如与本步骤相关请参考）`,
        );
      }
    }

    return `### 步骤「${step.title}」（${step.id}）\n${step.content}\n关联讨论：\n${
      lines.length > 0 ? lines.join("\n") : "  （本步骤暂无关联讨论）"
    }`;
  });

  const unlinked = context.turns
    .filter((turn) => (stepIdsByTurn.get(turn.id) ?? []).length === 0)
    .map((turn) => `  - 【轮次 ${turn.id}】用户：${turn.userMessage} / 助手：${turn.assistantMessage}`);

  const userContent = `# 题目
${context.question.content}

# 分步解答与各步骤关联讨论
${sections.join("\n\n")}

# 未关联步骤的讨论
${unlinked.length > 0 ? unlinked.join("\n") : "（无）"}`;

  return [
    {
      role: "system",
      content: resolveSystemPrompt(
        "explanation_generation",
        options?.systemPrompt,
      ),
    },
    { role: "user", content: userContent },
  ];
}
