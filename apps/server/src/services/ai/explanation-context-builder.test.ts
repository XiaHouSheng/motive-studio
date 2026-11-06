import type { ConversationTurn, Question, SolutionStep, TurnStepTag } from "@motive/shared";
import { describe, expect, it } from "vitest";
import type { ExplanationContextData } from "../../repositories/workspace-repository.js";
import { buildExplanationMessages } from "./explanation-context-builder.js";

function makeQuestion(): Question {
  return {
    id: "q-1",
    groupId: "g-1",
    content: "题目内容",
    solutionStepIds: ["s-1", "s-2"],
    imagePolicy: "auto",
    assets: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

function makeSteps(): SolutionStep[] {
  return [
    { id: "s-1", questionId: "q-1", order: 1, title: "第一步", content: "步骤一内容", updatedAt: 0 },
    { id: "s-2", questionId: "q-1", order: 2, title: "第二步", content: "步骤二内容", updatedAt: 0 },
  ];
}

function makeTurn(id: string, userMessage: string): ConversationTurn {
  return {
    id,
    subConversationId: "sub-1",
    userMessage,
    assistantMessage: `回答：${userMessage}`,
    createdAt: 0,
    tagStatus: "tagged",
  };
}

function makeContext(
  overrides: Partial<Pick<ExplanationContextData, "turns" | "tags">> = {},
): ExplanationContextData {
  return {
    question: makeQuestion(),
    steps: makeSteps(),
    turns: [],
    tags: [],
    ...overrides,
  };
}

function userContentOf(context: ExplanationContextData): string {
  const messages = buildExplanationMessages(context);
  expect(messages[0].role).toBe("system");
  expect(messages[1].role).toBe("user");
  return messages[1].content as string;
}

describe("buildExplanationMessages", () => {
  it("没有任何讨论时也能构建上下文", () => {
    const content = userContentOf(makeContext());

    expect(content).toContain("题目内容");
    expect(content).toContain("### 步骤「第一步」（s-1）");
    expect(content).toContain("本步骤暂无关联讨论");
    // 未关联讨论段为空时渲染占位符
    expect(content).toContain("（无）");
    // 不应出现任何轮次行
    expect(content).not.toContain("【轮次");
  });

  it("按 tag 关联轮次到步骤，未关联轮次进入独立段落", () => {
    const tags: TurnStepTag[] = [
      { id: "tag-1", turnId: "t-1", stepId: "s-1", relevance: "相关", createdAt: 0 },
    ];
    const context = makeContext({
      turns: [makeTurn("t-1", "为什么要配方？"), makeTurn("t-2", "端点怎么算？")],
      tags,
    });
    const content = userContentOf(context);

    expect(content).toContain("【轮次 t-1】用户：为什么要配方？");
    expect(content).toContain("回答：为什么要配方？");
    // 未关联步骤的讨论单独列出
    expect(content).toContain("【轮次 t-2】用户：端点怎么算？");
  });
});
