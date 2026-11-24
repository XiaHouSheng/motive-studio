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
  overrides: Partial<Pick<ExplanationContextData, "steps" | "turns" | "tags">> = {},
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
    expect(content).toContain("### 步骤 1（第一步）");
    expect(content).toContain("本步骤暂无关联讨论");
    // 步骤 ID（含非 UUID 的短 id）不得进入上下文
    expect(content).not.toContain("（s-1）");
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

    expect(content).toContain("【轮次 1】用户：为什么要配方？");
    expect(content).toContain("回答：为什么要配方？");
    // 未关联步骤的讨论单独列出（按时间顺序编号）
    expect(content).toContain("【轮次 2】用户：端点怎么算？");
    // 轮次 ID 不得出现在上下文里
    expect(content).not.toContain("t-1");
    expect(content).not.toContain("t-2");
  });

  it("存量轮次文本里的步骤 UUID 清洗为「步骤 N（标题）」", () => {
    const uuid1 = "550e8400-e29b-41d4-a716-446655440000";
    const context = makeContext({
      steps: [
        { id: uuid1, questionId: "q-1", order: 1, title: "第一步", content: "步骤一内容", updatedAt: 0 },
        { id: "s-2", questionId: "q-1", order: 2, title: "第二步", content: "步骤二内容", updatedAt: 0 },
      ],
      turns: [makeTurn("t-1", `关于 [${uuid1}] 为什么要配方？`)],
      tags: [{ id: "tag-1", turnId: "t-1", stepId: uuid1, relevance: "相关", createdAt: 0 }],
    });
    const content = userContentOf(context);

    expect(content).toContain("【轮次 1】用户：关于 步骤 1（第一步） 为什么要配方？");
    expect(content).not.toContain(uuid1);
  });

  it("重新生成附带的补充要求注入用户提示词", () => {
    // 未附带补充要求时不含该段落
    expect(userContentOf(makeContext())).not.toContain("# 用户补充要求");

    const messages = buildExplanationMessages(makeContext(), {
      extraRequirement: "突出与第 2 步的衔接",
    });
    const withExtra = messages[1].content as string;
    expect(withExtra).toContain("# 用户补充要求");
    expect(withExtra).toContain("突出与第 2 步的衔接");
  });
});
