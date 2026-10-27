import type { ChatMessage, ChatStreamEvent } from "@motive/shared";

export interface ChatRequest {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface AIProvider {
  streamChat(request: ChatRequest, signal?: AbortSignal): AsyncGenerator<ChatStreamEvent>;
}
