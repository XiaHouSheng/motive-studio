import type { ChatMessage } from "@motive/shared";
import { resolveSystemPrompt } from "./effective-prompt.js";
import type { ChatContextData } from "../../repositories/workspace-repository.js";

export const CHAT_TEMPERATURE = 0.5;

export function buildChatMessages(
  context: ChatContextData,
  userMessage: string,
  options?: { systemPrompt?: string },
): ChatMessage[] {
  const stepList = context.steps
    .map((step) => `- [${step.id}] ${step.title}`)
    .join("\n");

  const history =
    context.history.length === 0
      ? "暂无历史讨论"
      : context.history
          .map(
            (turn) => `用户：${turn.userMessage}\n助手：${turn.assistantMessage}`,
          )
          .join("\n\n");

  const userContent = `# 题目
${context.question.content}

# 解题步骤列表（[步骤ID] 标题）
${stepList}

# 入口步骤「${context.entryStep.title}」的正式内容
${context.entryStep.content}

# 历史讨论
${history}

# 用户新消息
${userMessage}`;

  return [
    {
      role: "system",
      content: resolveSystemPrompt("step_discussion", options?.systemPrompt),
    },
    { role: "user", content: userContent },
  ];
}
