import type { ChatMessage, SolutionStepDraft, TokenUsage } from "@motive/shared";
import { resolveSystemPrompt } from "./effective-prompt.js";
import { AIError } from "./errors.js";
import type { AIProvider } from "./types.js";

export const SOLUTION_TEMPERATURE = 0.2;

const MAX_ATTEMPTS = 2;
const MAX_STEPS = 10;
const MAX_TITLE_LENGTH = 60;

/** 题解生成结果：解析出的步骤草稿 + 成功那次请求的 token 用量 */
export interface SolutionGenerationWithUsage {
  drafts: SolutionStepDraft[];
  usage?: TokenUsage;
}

/** 拼接用户在重新生成时键入的补充要求（空串忽略） */
export function appendExtraRequirement(userContent: string, extraRequirement?: string): string {
  const trimmed = extraRequirement?.trim();
  return trimmed ? `${userContent}\n\n# 用户补充要求\n${trimmed}` : userContent;
}

export function buildSolutionMessages(
  questionContent: string,
  options?: { systemPrompt?: string; enableMermaid?: boolean; extraRequirement?: string },
): ChatMessage[] {
  return [
    {
      role: "system",
      content: resolveSystemPrompt("solution_generation", options?.systemPrompt, {
        enableMermaid: options?.enableMermaid,
      }),
    },
    {
      role: "user",
      content: appendExtraRequirement(`# 题目\n${questionContent}`, options?.extraRequirement),
    },
  ];
}

export function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}

export function parseSolutionDraft(raw: string): SolutionStepDraft[] {
  const text = stripCodeFence(raw);
  if (!text) {
    throw new AIError("INVALID_RESPONSE", "模型未返回题解内容");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AIError("INVALID_RESPONSE", "模型返回的题解不是有效 JSON");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new AIError("INVALID_RESPONSE", "模型返回的题解格式不正确");
  }

  const rawSteps = (parsed as { steps?: unknown }).steps;
  if (!Array.isArray(rawSteps) || rawSteps.length < 1 || rawSteps.length > MAX_STEPS) {
    throw new AIError(
      "INVALID_RESPONSE",
      `题解步骤数量需在 1 到 ${MAX_STEPS} 之间`,
    );
  }

  return rawSteps.map((item, index) => {
    if (typeof item !== "object" || item === null) {
      throw new AIError("INVALID_RESPONSE", `第 ${index + 1} 步格式不正确`);
    }

    const record = item as { title?: unknown; content?: unknown };
    const title = typeof record.title === "string" ? record.title.trim() : "";
    const content = typeof record.content === "string" ? record.content.trim() : "";

    if (!title) {
      throw new AIError("INVALID_RESPONSE", `第 ${index + 1} 步缺少标题`);
    }
    if (!content) {
      throw new AIError("INVALID_RESPONSE", `第 ${index + 1} 步缺少内容`);
    }

    return { title: title.slice(0, MAX_TITLE_LENGTH), content };
  });
}

/** 一次上游请求收集到的正文与用量（usage 事件由 provider 在流末尾发出） */
interface CollectedResponse {
  text: string;
  usage?: TokenUsage;
}

async function collectResponseWithUsage(
  provider: AIProvider,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<CollectedResponse> {
  let text = "";
  let usage: TokenUsage | undefined;
  for await (const event of provider.streamChat(
    { messages, temperature: SOLUTION_TEMPERATURE },
    signal,
  )) {
    if (event.type === "text-delta") {
      text += event.text;
      continue;
    }
    if (event.type === "usage") {
      if (event.inputTokens !== undefined || event.outputTokens !== undefined) {
        usage = {
          inputTokens: event.inputTokens ?? usage?.inputTokens ?? 0,
          outputTokens: event.outputTokens ?? usage?.outputTokens ?? 0,
        };
      }
      continue;
    }
    if (event.type === "error") {
      throw new AIError(event.code, event.message);
    }
  }
  return { text, usage };
}

export async function generateSolution(
  provider: AIProvider,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<SolutionGenerationWithUsage> {
  let lastError: AIError | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const { text, usage } = await collectResponseWithUsage(provider, messages, signal);
    try {
      return { drafts: parseSolutionDraft(text), usage };
    } catch (error) {
      if (!(error instanceof AIError)) throw error;
      lastError = error;
    }
  }

  throw lastError ?? new AIError("INVALID_RESPONSE", "模型未返回有效题解");
}
