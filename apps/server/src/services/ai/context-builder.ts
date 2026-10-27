import type { ChatMessage } from "@motive/shared";
import type { ChatContextData } from "../../repositories/workspace-repository.js";

export const CHAT_TEMPERATURE = 0.5;

const SYSTEM_PROMPT = `你是一个严谨的解题学习助手。你的回答必须基于给定的上下文，不确定的内容要明确说明，不得编造。
你在"深度理解子对话"中，帮助用户理解当前解题步骤。入口步骤只是讨论起点，用户可以自然地讨论其他步骤。
要求：
1. 回答要具体、准确，紧扣用户的疑问。
2. 必要时引用其他步骤的结论，并说明依据。
3. 不要修改正式题解，那由用户触发归档另行处理。
4. 用中文回答，适度使用 Markdown。`;

export function buildChatMessages(
  context: ChatContextData,
  userMessage: string,
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
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];
}
