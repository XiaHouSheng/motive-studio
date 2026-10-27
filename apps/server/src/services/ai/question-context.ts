import type { ChatMessage, ImagePolicy } from "@motive/shared";
import { HttpError } from "../../http-error.js";
import type { QuestionContextSource } from "../../repositories/workspace-repository.js";
import type { AssetStore } from "../asset-store.js";
import { buildSolutionMessages } from "./solution-generator.js";

/** 单次请求最多附带的原图数量，避免上下文过大 */
export const MAX_CONTEXT_IMAGES = 4;

export interface ContextProvider {
  supportsVision: boolean;
  model: string;
}

export interface BuiltQuestionContext {
  messages: ChatMessage[];
  includedAssetIds: string[];
  imagePolicy: ImagePolicy;
  reasons: string[];
  warnings: string[];
}

function imagePart(mimeType: string, bytes: Buffer) {
  return {
    type: "image_url" as const,
    image_url: { url: `data:${mimeType};base64,${bytes.toString("base64")}` },
  };
}

/**
 * 题解生成的统一素材入口：按「题目图片策略 + 模型视觉能力」确定是否附原图。
 * 纯文本分支复用 buildSolutionMessages，保证与既有提示词完全一致。
 */
export function buildQuestionContext(input: {
  question: QuestionContextSource;
  provider: ContextProvider;
  store: AssetStore;
}): BuiltQuestionContext {
  const { question, provider, store } = input;
  const base = buildSolutionMessages(question.content);
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (question.assets.length === 0) {
    return {
      messages: base,
      includedAssetIds: [],
      imagePolicy: question.imagePolicy,
      reasons: ["no_assets"],
      warnings,
    };
  }

  if (question.imagePolicy === "never") {
    return {
      messages: base,
      includedAssetIds: [],
      imagePolicy: question.imagePolicy,
      reasons: ["policy_never"],
      warnings,
    };
  }

  if (!provider.supportsVision) {
    if (question.imagePolicy === "always") {
      throw new HttpError(
        400,
        "VISION_UNSUPPORTED",
        "当前模型不支持图片输入，请更换模型或在题目设置中改用 auto",
      );
    }
    warnings.push("vision_unsupported_fallback");
    return {
      messages: base,
      includedAssetIds: [],
      imagePolicy: question.imagePolicy,
      reasons: ["auto_vision_unsupported"],
      warnings,
    };
  }

  const selected = question.assets.slice(0, MAX_CONTEXT_IMAGES);
  reasons.push(question.imagePolicy === "always" ? "policy_always" : "auto_has_assets");
  if (question.assets.length > selected.length) warnings.push("assets_truncated");

  return {
    messages: [
      base[0],
      {
        role: "user",
        content: [
          { type: "text", text: `# 题目\n${question.content}` },
          ...selected.map((asset) =>
            imagePart(asset.mimeType, store.read(asset.storagePath)),
          ),
        ],
      },
    ],
    includedAssetIds: selected.map((asset) => asset.id),
    imagePolicy: question.imagePolicy,
    reasons,
    warnings,
  };
}
