import type {
  ChatStreamEvent,
  ProviderConfig,
} from "@motive/shared";
import { createSseParser } from "@motive/shared";
import { AIError, mapUpstreamStatus } from "./errors.js";
import type { AIProvider, ChatRequest } from "./types.js";

interface ParsedChunk {
  events: ChatStreamEvent[];
  done: boolean;
}

export class OpenAIProvider implements AIProvider {
  private readonly config: ProviderConfig;
  private readonly apiKey: string;

  constructor(config: ProviderConfig, apiKey: string) {
    this.config = config;
    this.apiKey = apiKey;
  }

  async *streamChat(
    request: ChatRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<ChatStreamEvent> {
    const url = `${this.config.baseUrl.replace(/\/+$/, "")}/chat/completions`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: request.messages,
          stream: true,
          stream_options: { include_usage: true },
          temperature: request.temperature ?? this.config.temperature,
          max_tokens: request.maxTokens ?? this.config.maxTokens,
        }),
        signal,
      });
    } catch (error) {
      if (isAbort(error, signal)) {
        throw new AIError("CANCELLED", "生成已取消");
      }
      throw new AIError("NETWORK_ERROR", "无法连接模型服务，请检查 Base URL 与网络");
    }

    if (!response.ok) {
      const detail = await readErrorDetail(response);
      throw new AIError(
        mapUpstreamStatus(response.status),
        `模型服务返回错误（${response.status}）${detail ? `：${detail}` : ""}`,
        response.status,
      );
    }
    if (!response.body) {
      throw new AIError("INVALID_RESPONSE", "模型服务未返回流式响应");
    }

    const parser = createSseParser();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let finishReason: string | undefined;

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const payloads = parser.push(decoder.decode(value, { stream: true }));
        for (const payload of payloads) {
          const chunk = parsePayload(payload, finishReason);
          finishReason = chunk.finishReason;
          for (const event of chunk.events) yield event;
          if (chunk.done) {
            parser.flush();
            return yield* emitCompleted(finishReason);
          }
        }
      }

      for (const payload of parser.flush()) {
        const chunk = parsePayload(payload, finishReason);
        finishReason = chunk.finishReason;
        for (const event of chunk.events) yield event;
        if (chunk.done) break;
      }
    } catch (error) {
      if (error instanceof AIError) throw error;
      if (isAbort(error, signal)) throw new AIError("CANCELLED", "生成已取消");
      throw new AIError("NETWORK_ERROR", "读取模型响应时连接中断");
    } finally {
      reader.releaseLock();
    }

    yield* emitCompleted(finishReason);
  }
}

function* emitCompleted(
  finishReason?: string,
): Generator<ChatStreamEvent> {
  yield { type: "completed", finishReason };
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return error instanceof DOMException && error.name === "AbortError";
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (!text) return "";
    try {
      const body = JSON.parse(text) as { error?: { message?: string } };
      return (body.error?.message ?? text).slice(0, 300);
    } catch {
      return text.slice(0, 300);
    }
  } catch {
    return "";
  }
}

function parsePayload(
  payload: string,
  previousFinishReason?: string,
): { events: ChatStreamEvent[]; done: boolean; finishReason?: string } & ParsedChunk {
  const trimmed = payload.trim();
  if (!trimmed) return { events: [], done: false, finishReason: previousFinishReason };
  if (trimmed === "[DONE]") {
    return { events: [], done: true, finishReason: previousFinishReason };
  }

  let body: unknown;
  try {
    body = JSON.parse(trimmed);
  } catch {
    throw new AIError("INVALID_RESPONSE", "模型返回了无法解析的流式数据");
  }

  if (typeof body !== "object" || body === null) {
    throw new AIError("INVALID_RESPONSE", "模型返回了无效的流式数据");
  }

  const record = body as {
    error?: { message?: string };
    choices?: Array<{
      delta?: { content?: string | null };
      finish_reason?: string | null;
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  if (record.error) {
    throw new AIError(
      "PROVIDER_ERROR",
      record.error.message?.slice(0, 300) || "模型服务返回了错误",
    );
  }

  const events: ChatStreamEvent[] = [];
  let finishReason = previousFinishReason;

  const choice = record.choices?.[0];
  const text = choice?.delta?.content;
  if (typeof text === "string" && text.length > 0) {
    events.push({ type: "text-delta", text });
  }
  if (choice?.finish_reason) {
    finishReason = choice.finish_reason;
  }

  if (record.usage) {
    events.push({
      type: "usage",
      inputTokens:
        typeof record.usage.prompt_tokens === "number"
          ? record.usage.prompt_tokens
          : undefined,
      outputTokens:
        typeof record.usage.completion_tokens === "number"
          ? record.usage.completion_tokens
          : undefined,
    });
  }

  return { events, done: false, finishReason };
}
