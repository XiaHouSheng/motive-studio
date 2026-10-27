import { describe, expect, it } from "vitest";
import type { ArchiveContextData } from "../../repositories/workspace-repository.js";
import { AIError } from "./errors.js";
import { buildArchiveMessages } from "./archive-context-builder.js";
import { parseArchiveProposal } from "./archive-generator.js";

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

const VALID = JSON.stringify({
  summary: "补充端点比较的说明",
  changes: [
    {
      stepId: "s-1",
      action: "add_explanation",
      proposedContent: " 还可以补充端点比较的原则。 ",
      rationale: "讨论中解释了候选值来源",
      sourceTurnIds: ["t-1"],
    },
    {
      stepId: "s-2",
      action: "no_change",
      rationale: "现有内容已经覆盖",
      sourceTurnIds: [],
    },
  ],
});

describe("parseArchiveProposal", () => {
  it("解析围栏 JSON 并裁剪内容", () => {
    const proposal = parseArchiveProposal(`\`\`\`json\n${VALID}\n\`\`\``);
    expect(proposal.summary).toBe("补充端点比较的说明");
    expect(proposal.changes).toHaveLength(2);
    expect(proposal.changes[0]).toEqual({
      stepId: "s-1",
      action: "add_explanation",
      proposedContent: "还可以补充端点比较的原则。",
      rationale: "讨论中解释了候选值来源",
      sourceTurnIds: ["t-1"],
    });
    expect(proposal.changes[1].action).toBe("no_change");
    expect(proposal.changes[1].proposedContent).toBeUndefined();
  });

  it("接受空变更列表", () => {
    const proposal = parseArchiveProposal('{"summary":"无需修改","changes":[]}');
    expect(proposal.changes).toEqual([]);
  });

  it("拒绝非法 JSON 与空响应", () => {
    expectInvalid(() => parseArchiveProposal("这不是 JSON"));
    expectInvalid(() => parseArchiveProposal(""));
  });

  it("拒绝非法 action", () => {
    expectInvalid(() =>
      parseArchiveProposal(
        JSON.stringify({
          summary: "概述",
          changes: [
            {
              stepId: "s-1",
              action: "rewrite_everything",
              rationale: "依据",
              sourceTurnIds: ["t-1"],
            },
          ],
        }),
      ),
    );
  });

  it("拒绝追加/重写时缺少内容或来源", () => {
    expectInvalid(() =>
      parseArchiveProposal(
        JSON.stringify({
          summary: "概述",
          changes: [
            {
              stepId: "s-1",
              action: "revise_content",
              rationale: "依据",
              sourceTurnIds: ["t-1"],
            },
          ],
        }),
      ),
    );
    expectInvalid(() =>
      parseArchiveProposal(
        JSON.stringify({
          summary: "概述",
          changes: [
            {
              stepId: "s-1",
              action: "add_explanation",
              proposedContent: "内容",
              rationale: "依据",
              sourceTurnIds: [],
            },
          ],
        }),
      ),
    );
  });

  it("拒绝 no_change 携带内容", () => {
    expectInvalid(() =>
      parseArchiveProposal(
        JSON.stringify({
          summary: "概述",
          changes: [
            {
              stepId: "s-1",
              action: "no_change",
              proposedContent: "不该出现",
              rationale: "依据",
              sourceTurnIds: ["t-1"],
            },
          ],
        }),
      ),
    );
  });

  it("拒绝缺少概述与结构异常", () => {
    expectInvalid(() => parseArchiveProposal('{"changes":[]}'));
    expectInvalid(() => parseArchiveProposal('{"summary":"概述","changes":{}}'));
  });

  it("拒绝超过 20 项变更", () => {
    const changes = Array.from({ length: 21 }, (_, index) => ({
      stepId: `s-${index}`,
      action: "no_change",
      rationale: "依据",
      sourceTurnIds: [],
    }));
    expectInvalid(() => parseArchiveProposal(JSON.stringify({ summary: "概述", changes })));
  });
});

describe("buildArchiveMessages", () => {
  it("包含题目、步骤 ID 与讨论轮次 ID", () => {
    const context: ArchiveContextData = {
      question: {
        id: "q-1",
        groupId: "g-1",
        content: "已知函数 f(x)=x²-6x+5",
        solutionStepIds: ["s-1"],
        imagePolicy: "auto",
        assets: [],
        createdAt: 1,
        updatedAt: 1,
      },
      steps: [
        {
          id: "s-1",
          questionId: "q-1",
          order: 1,
          title: "配方",
          content: "化为顶点式",
          updatedAt: 1,
        },
      ],
      entryStep: {
        id: "s-1",
        questionId: "q-1",
        order: 1,
        title: "配方",
        content: "化为顶点式",
        updatedAt: 1,
      },
      discussion: {
        id: "sub-1",
        entryStepId: "s-1",
        turnIds: ["t-1"],
        createdAt: 1,
        updatedAt: 1,
      },
      turns: [
        {
          id: "t-1",
          subConversationId: "sub-1",
          userMessage: "为什么要比较端点？",
          assistantMessage: "因为区间有界",
          createdAt: 1,
          archiveStatus: "unarchived",
          tagStatus: "tagged",
        },
      ],
      tags: [
        {
          id: "tag-1",
          turnId: "t-1",
          stepId: "s-1",
          createdAt: 1,
        },
      ],
    };

    const messages = buildArchiveMessages(context);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("只输出 JSON");
    expect(messages[1].content).toContain("已知函数 f(x)=x²-6x+5");
    expect(messages[1].content).toContain("[s-1] 1. 配方");
    expect(messages[1].content).toContain("[t-1]（关联步骤：s-1）");
  });
});
