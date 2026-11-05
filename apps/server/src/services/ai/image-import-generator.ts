import type { ChatMessage } from "@motive/shared";
import { resolveSystemPrompt } from "./effective-prompt.js";
import { AIError } from "./errors.js";
import { stripCodeFence } from "./solution-generator.js";
import type { AIProvider } from "./types.js";

export const IMAGE_IMPORT_TEMPERATURE = 0.1;

const MAX_ATTEMPTS = 2;
const MAX_QUESTIONS = 30;
const MAX_CONTENT_LENGTH = 40_000;

export interface ImportImage {
  mediaType: string;
  /** 不含 data URL 前缀的 base64 数据 */
  data: string;
}

export function buildImageImportMessages(
  images: ImportImage[],
  options?: { systemPrompt?: string; extraPrompt?: string },
): ChatMessage[] {
  // 附加要求只追加到 user 消息，不参与 system prompt 的覆盖与优先级解析
  const extraPrompt = options?.extraPrompt?.trim();
  const baseText =
    images.length > 1
      ? `请转写这 ${images.length} 张图片中的全部题目，并按图片顺序合并为一个数组。`
      : "请转写这张图片中的全部题目。";
  return [
    {
      role: "system",
      content: resolveSystemPrompt("image_import", options?.systemPrompt),
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: extraPrompt
            ? `${baseText}\n\n用户附加要求：${extraPrompt}`
            : baseText,
        },
        ...images.map((image) => ({
          type: "image_url" as const,
          image_url: { url: `data:${image.mediaType};base64,${image.data}` },
        })),
      ],
    },
  ];
}

export function parseImageQuestions(raw: string): string[] {
  const text = stripCodeFence(raw);
  if (!text) throw new AIError("INVALID_RESPONSE", "模型未返回识别结果");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AIError("INVALID_RESPONSE", "模型返回的识别结果不是有效 JSON");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new AIError("INVALID_RESPONSE", "模型返回的识别结果格式不正确");
  }

  const rawQuestions = (parsed as { questions?: unknown }).questions;
  if (!Array.isArray(rawQuestions)) {
    throw new AIError("INVALID_RESPONSE", "识别结果缺少 questions 数组");
  }
  if (rawQuestions.length > MAX_QUESTIONS) {
    throw new AIError("INVALID_RESPONSE", `单次最多导入 ${MAX_QUESTIONS} 道题目`);
  }

  const questions: string[] = [];
  for (const item of rawQuestions) {
    if (typeof item !== "string") {
      throw new AIError("INVALID_RESPONSE", "识别结果中存在非文本题目");
    }
    const content = item.trim();
    if (!content) continue;
    if (content.length > MAX_CONTENT_LENGTH) {
      throw new AIError("INVALID_RESPONSE", "识别出的单道题目内容过长");
    }
    questions.push(content);
  }

  return questions;
}

async function collectResponse(
  provider: AIProvider,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<string> {
  let text = "";
  for await (const event of provider.streamChat(
    { messages, temperature: IMAGE_IMPORT_TEMPERATURE },
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

export async function generateQuestionsFromImages(
  provider: AIProvider,
  images: ImportImage[],
  signal?: AbortSignal,
  options?: { systemPrompt?: string; extraPrompt?: string },
): Promise<string[]> {
  const messages = buildImageImportMessages(images, options);
  let lastError: AIError | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const raw = await collectResponse(provider, messages, signal);
    try {
      return parseImageQuestions(raw);
    } catch (error) {
      if (!(error instanceof AIError)) throw error;
      lastError = error;
    }
  }

  throw lastError ?? new AIError("INVALID_RESPONSE", "模型未返回有效识别结果");
}
