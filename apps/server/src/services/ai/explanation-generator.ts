import type { ChatMessage, TokenUsage } from "@motive/shared";
import { AIError } from "./errors.js";
import { stripCodeFence } from "./solution-generator.js";
import type { AIProvider } from "./types.js";

export const EXPLANATION_TEMPERATURE = 0.2;

const MAX_ATTEMPTS = 2;
const MIN_CONTENT_LENGTH = 20;
const MAX_CONTENT_LENGTH = 30_000;
const MAX_SUMMARY_LENGTH = 300;

export interface ExplanationDraft {
  content: string;
  summary: string;
  usage?: TokenUsage;
}

export function parseExplanationDraft(raw: string): Omit<ExplanationDraft, "usage"> {
  const text = stripCodeFence(raw);
  if (!text) throw new AIError("INVALID_RESPONSE", "模型未返回详解内容");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AIError("INVALID_RESPONSE", "模型返回的详解不是有效 JSON");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new AIError("INVALID_RESPONSE", "模型返回的详解格式不正确");
  }

  const record = parsed as { explanation?: unknown; summary?: unknown };
  const content =
    typeof record.explanation === "string" ? record.explanation.trim() : "";
  if (content.length < MIN_CONTENT_LENGTH) {
    throw new AIError("INVALID_RESPONSE", "模型返回的详解内容过短");
  }

  const rawSummary = typeof record.summary === "string" ? record.summary.trim() : "";
  const summary = (rawSummary || content.replace(/\s+/g, " ").slice(0, 60)).slice(
    0,
    MAX_SUMMARY_LENGTH,
  );

  return { content: content.slice(0, MAX_CONTENT_LENGTH), summary };
}

async function collectResponse(
  provider: AIProvider,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<{ text: string; usage?: TokenUsage }> {
  let text = "";
  let usage: TokenUsage | undefined;

  for await (const event of provider.streamChat(
    { messages, temperature: EXPLANATION_TEMPERATURE },
    signal,
  )) {
    if (event.type === "text-delta") {
      text += event.text;
      continue;
    }
    if (event.type === "usage") {
      if (event.inputTokens !== undefined || event.outputTokens !== undefined) {
        usage = {
          inputTokens: event.inputTokens ?? 0,
          outputTokens: event.outputTokens ?? 0,
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

export async function generateExplanation(
  provider: AIProvider,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<ExplanationDraft> {
  let lastError: AIError | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const { text, usage } = await collectResponse(provider, messages, signal);
    try {
      return { ...parseExplanationDraft(text), usage };
    } catch (error) {
      if (!(error instanceof AIError)) throw error;
      lastError = error;
    }
  }

  throw lastError ?? new AIError("INVALID_RESPONSE", "模型未返回有效详解");
}
