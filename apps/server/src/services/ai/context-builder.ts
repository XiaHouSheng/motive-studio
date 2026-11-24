import type { ChatMessage } from "@motive/shared";
import { replaceStepReferences } from "@motive/shared";
import { resolveSystemPrompt } from "./effective-prompt.js";
import type { ChatContextData } from "../../repositories/workspace-repository.js";

export const CHAT_TEMPERATURE = 0.5;

export interface ChatImageInput {
  mimeType: string;
  bytes: Buffer;
}

/** openai-chat-completions 的图片内容段（base64 data URL） */
export function chatImagePart(image: ChatImageInput) {
  return {
    type: "image_url" as const,
    image_url: { url: `data:${image.mimeType};base64,${image.bytes.toString("base64")}` },
  };
}

export function buildChatMessages(
  context: ChatContextData,
  userMessage: string,
  options?: { systemPrompt?: string; images?: ChatImageInput[] },
): ChatMessage[] {
  // 步骤只用「步骤 N（标题）」指代，禁止把步骤 ID（UUID）注入上下文，
  // 否则模型会模仿在回复里输出 UUID；历史讨论先清洗存量消息里的 UUID。
  const stepList = context.steps
    .map((step) => `- 步骤 ${step.order}（${step.title}）`)
    .join("\n");

  const history =
    context.history.length === 0
      ? "暂无历史讨论"
      : context.history
          .map((turn) => {
            const userText = replaceStepReferences(turn.userMessage, context.steps);
            const assistantText = replaceStepReferences(turn.assistantMessage, context.steps);
            return `用户：${userText}\n助手：${assistantText}`;
          })
          .join("\n\n");

  const userContent = `# 题目
${context.question.content}

# 解题步骤列表（步骤序号（标题））
${stepList}

# 入口步骤「${context.entryStep.title}」的正式内容
${context.entryStep.content}

# 历史讨论
${history}

# 用户新消息
${userMessage}`;

  const images = options?.images ?? [];
  const userMessageContent =
    images.length > 0
      ? [
          { type: "text" as const, text: userContent },
          ...images.map(chatImagePart),
        ]
      : userContent;

  return [
    {
      role: "system",
      content: resolveSystemPrompt("step_discussion", options?.systemPrompt),
    },
    { role: "user", content: userMessageContent },
  ];
}
