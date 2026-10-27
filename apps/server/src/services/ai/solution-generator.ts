import type { ChatMessage, SolutionStepDraft } from "@motive/shared";
import { AIError } from "./errors.js";
import type { AIProvider } from "./types.js";

export const SOLUTION_TEMPERATURE = 0.2;

const MAX_ATTEMPTS = 2;
const MAX_STEPS = 10;
const MAX_TITLE_LENGTH = 60;

const SYSTEM_PROMPT = `你是一个严谨的解题学习助手。你的回答必须基于给定的上下文，不确定的内容要明确说明，不得编造。
你是解题专家。请为给定题目生成结构化的分步题解。
要求：步骤数量 3~6 个；每步标题简短（15 字内）、内容完整可读；步骤之间有清晰的推导关系。
数学公式必须用 LaTeX：行内公式用 $...$，独立公式用 $$...$$；禁止用 Unicode 上下标（如 x²、a₁）或裸文本表示公式。
只输出 JSON，格式：
{"steps":[{"title":"步骤标题","content":"该步骤的正式解题内容"}]}`;

export function buildSolutionMessages(questionContent: string): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `# 题目\n${questionContent}` },
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

async function collectResponse(
  provider: AIProvider,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<string> {
  let text = "";
  for await (const event of provider.streamChat(
    { messages, temperature: SOLUTION_TEMPERATURE },
    signal,
  )) {
    if (event.type === "text-delta") {
      text += event.text;
      continue;
    }
    if (event.type === "error") {
      throw new AIError(event.code, event.message);
    }
  }
  return text;
}

export async function generateSolution(
  provider: AIProvider,
  questionContent: string,
  signal?: AbortSignal,
): Promise<SolutionStepDraft[]> {
  const messages = buildSolutionMessages(questionContent);
  let lastError: AIError | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const raw = await collectResponse(provider, messages, signal);
    try {
      return parseSolutionDraft(raw);
    } catch (error) {
      if (!(error instanceof AIError)) throw error;
      lastError = error;
    }
  }

  throw lastError ?? new AIError("INVALID_RESPONSE", "模型未返回有效题解");
}
