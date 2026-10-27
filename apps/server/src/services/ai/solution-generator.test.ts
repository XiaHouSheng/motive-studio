import { describe, expect, it } from "vitest";
import { AIError } from "./errors.js";
import {
  buildSolutionMessages,
  parseSolutionDraft,
  stripCodeFence,
} from "./solution-generator.js";

function expectInvalid(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AIError);
    expect((error as AIError).code).toBe("INVALID_RESPONSE");
    return;
  }
  throw new Error("应当抛出 AIError");
}

describe("parseSolutionDraft", () => {
  it("解析 JSON 并去除围栏、裁剪标题", () => {
    const title = "步骤标题".repeat(20);
    const raw = `\`\`\`json
{"steps":[{"title":" ${title} ","content":" 内容 "}]}
\`\`\``;

    expect(parseSolutionDraft(raw)).toEqual([
      { title: title.slice(0, 60), content: "内容" },
    ]);
  });

  it("接受裸 JSON", () => {
    const steps = parseSolutionDraft(
      '{"steps":[{"title":"第一步","content":"内容"},{"title":"第二步","content":"内容"}]}',
    );
    expect(steps.map((step) => step.title)).toEqual(["第一步", "第二步"]);
  });

  it("拒绝非法 JSON 与空响应", () => {
    expectInvalid(() => parseSolutionDraft("这不是 JSON"));
    expectInvalid(() => parseSolutionDraft(""));
  });

  it("拒绝步骤数量不在 1~10 之间", () => {
    expectInvalid(() => parseSolutionDraft('{"steps":[]}'));
    const eleven = {
      steps: Array.from({ length: 11 }, (_, index) => ({
        title: `步骤 ${index + 1}`,
        content: "内容",
      })),
    };
    expectInvalid(() => parseSolutionDraft(JSON.stringify(eleven)));
  });

  it("拒绝缺失标题或内容", () => {
    expectInvalid(() =>
      parseSolutionDraft('{"steps":[{"title":"","content":"内容"}]}'),
    );
    expectInvalid(() =>
      parseSolutionDraft('{"steps":[{"title":"标题","content":"  "}]}'),
    );
  });
});

describe("提示词与围栏", () => {
  it("System 要求只输出 JSON，User 仅包含题目", () => {
    const messages = buildSolutionMessages("已知函数 f(x)=x²");
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("只输出 JSON");
    expect(messages[1]).toEqual({
      role: "user",
      content: "# 题目\n已知函数 f(x)=x²",
    });
  });

  it("围栏不完整时保留原文", () => {
    expect(stripCodeFence("```json\n{}\n```extra")).toBe("```json\n{}\n```extra");
  });
});
