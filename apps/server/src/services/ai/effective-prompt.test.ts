import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildChatMessages } from "./context-builder.js";
import {
  DEFAULT_PROMPTS,
  MERMAID_DIAGRAM_RULE,
  PLAIN_DIAGRAM_RULE,
  resolveSystemPrompt,
} from "./effective-prompt.js";
import { buildExplanationMessages } from "./explanation-context-builder.js";
import { buildImageImportMessages } from "./image-import-generator.js";
import { buildQuestionContext } from "./question-context.js";
import { buildSolutionMessages } from "./solution-generator.js";
import { AssetStore } from "../asset-store.js";
import type { QuestionContextSource } from "../../repositories/workspace-repository.js";

const CUSTOM = "自定义系统提示词：始终用英文输出 JSON。";

function systemOf(messages: Array<{ role: string; content: unknown }>): string {
  expect(messages[0].role).toBe("system");
  return messages[0].content as string;
}

describe("resolveSystemPrompt", () => {
  it("未提供或纯空白时回退默认提示词", () => {
    for (const stage of Object.keys(DEFAULT_PROMPTS) as Array<keyof typeof DEFAULT_PROMPTS>) {
      expect(resolveSystemPrompt(stage, undefined)).toBe(DEFAULT_PROMPTS[stage]);
      expect(resolveSystemPrompt(stage, "")).toBe(DEFAULT_PROMPTS[stage]);
      expect(resolveSystemPrompt(stage, "   \n\t ")).toBe(DEFAULT_PROMPTS[stage]);
    }
  });

  it("非空自定义值原样生效", () => {
    expect(resolveSystemPrompt("solution_generation", CUSTOM)).toBe(CUSTOM);
  });

  it("solution_generation 按开关追加示意图规则；自定义提示词不追加", () => {
    expect(resolveSystemPrompt("solution_generation", undefined, { enableMermaid: false })).toBe(
      `${DEFAULT_PROMPTS.solution_generation}\n${PLAIN_DIAGRAM_RULE}`,
    );
    expect(resolveSystemPrompt("solution_generation", undefined, { enableMermaid: true })).toBe(
      `${DEFAULT_PROMPTS.solution_generation}\n${MERMAID_DIAGRAM_RULE}`,
    );
    // 未提供开关时保持原默认文案（不含规则附录）
    expect(resolveSystemPrompt("solution_generation", undefined)).toBe(
      DEFAULT_PROMPTS.solution_generation,
    );
    // 自定义提示词完全接管，不追加任何规则
    expect(resolveSystemPrompt("solution_generation", CUSTOM, { enableMermaid: true })).toBe(
      CUSTOM,
    );
    // 其他环节不受开关影响
    expect(resolveSystemPrompt("step_discussion", undefined, { enableMermaid: true })).toBe(
      DEFAULT_PROMPTS.step_discussion,
    );
  });
});

describe("各环节的 build*Messages 注入自定义提示词", () => {
  it("分步题解：自定义生效，缺省回退默认", () => {
    expect(systemOf(buildSolutionMessages("题目内容", { systemPrompt: CUSTOM }))).toBe(CUSTOM);
    expect(systemOf(buildSolutionMessages("题目内容"))).toBe(DEFAULT_PROMPTS.solution_generation);
    expect(systemOf(buildSolutionMessages("题目内容", { enableMermaid: true }))).toBe(
      `${DEFAULT_PROMPTS.solution_generation}\n${MERMAID_DIAGRAM_RULE}`,
    );
  });

  it("步骤讨论：自定义生效，缺省回退默认", () => {
    const context = {
      question: { id: "q-1", content: "题目" },
      entryStep: { id: "s-1", title: "步骤", content: "内容", order: 1 },
      steps: [{ id: "s-1", title: "步骤", content: "内容", order: 1 }],
      history: [],
    } as unknown as Parameters<typeof buildChatMessages>[0];
    expect(systemOf(buildChatMessages(context, "问", { systemPrompt: CUSTOM }))).toBe(CUSTOM);
    expect(systemOf(buildChatMessages(context, "问"))).toBe(DEFAULT_PROMPTS.step_discussion);
  });

  it("题目详解：自定义生效，缺省回退默认", () => {
    const context = {
      question: { id: "q-1", content: "题目" },
      steps: [],
      turns: [],
      tags: [],
    } as unknown as Parameters<typeof buildExplanationMessages>[0];
    expect(systemOf(buildExplanationMessages(context, { systemPrompt: CUSTOM }))).toBe(CUSTOM);
    expect(systemOf(buildExplanationMessages(context))).toBe(
      DEFAULT_PROMPTS.explanation_generation,
    );
  });

  it("题目图片识别：自定义生效，缺省回退默认", () => {
    const images = [{ mediaType: "image/png", data: "iVBORw0KGgo=" }];
    expect(systemOf(buildImageImportMessages(images, { systemPrompt: CUSTOM }))).toBe(CUSTOM);
    expect(systemOf(buildImageImportMessages(images))).toBe(DEFAULT_PROMPTS.image_import);
  });
});

describe("buildQuestionContext 两条分支注入自定义提示词", () => {
  let dir: string;
  let store: AssetStore;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "motive-effective-prompt-"));
    store = new AssetStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const provider = { supportsVision: true, model: "test-model" };

  it("纯文本分支（无题目图片）使用自定义提示词", () => {
    const question: QuestionContextSource = {
      content: "题目内容",
      imagePolicy: "auto",
      assets: [],
    };
    const context = buildQuestionContext({ question, provider, store, systemPrompt: CUSTOM });
    expect(systemOf(context.messages)).toBe(CUSTOM);
    expect(context.messages[1].role).toBe("user");
  });

  it("多模态分支（附带题目原图）使用自定义提示词", () => {
    const asset = store.write(store.prepare("image/png", "iVBORw0KGgo="));
    const question: QuestionContextSource = {
      content: "题目内容",
      imagePolicy: "always",
      assets: [{ id: "asset-1", mimeType: asset.mimeType, storagePath: asset.storagePath }],
    };
    const context = buildQuestionContext({ question, provider, store, systemPrompt: CUSTOM });
    expect(systemOf(context.messages)).toBe(CUSTOM);

    // 多模态 user 消息保留原图
    const parts = context.messages[1].content as Array<{ type: string }>;
    expect(parts.some((part) => part.type === "image_url")).toBe(true);

    // 缺省时两条分支均回退默认
    const fallback = buildQuestionContext({ question, provider, store });
    expect(systemOf(fallback.messages)).toBe(DEFAULT_PROMPTS.solution_generation);
  });
});
