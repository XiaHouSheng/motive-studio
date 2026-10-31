import type { ChatMessage } from "@motive/shared";
import type { ExplanationContextData } from "../../repositories/workspace-repository.js";

const SYSTEM_PROMPT = `你是一个严谨的解题学习助手。你的回答必须基于给定的上下文，不确定的内容要明确说明，不得编造。
你是解题详解撰写者。请基于题目的分步解答与用户在讨论中不懂的地方，输出一份完整的题目详解（Markdown）。
写作规则：
1. 以步骤为顺序组织（使用 ## 标题），读起来是一篇连贯的详解文章，而不是步骤原文的拼接。
2. 每个步骤下先完整讲解该步的推理与依据；融入该步骤关联讨论时，必须先以整行粗体单独点出用户的原始问题（如单独一行 **问：为什么 (x-2)²≥0 就能推出 f(x)≥-1？**），随后另起段落给出解答；不得出现与讨论无关的凭空补充，也不得以问答罗列的形式呈现。
3. 已确认的修正落实到行文；尚未验证的推测在对应步骤末尾以 "> ⚠️ 待验证：…" 单独标注，不得当作结论陈述。
4. 讨论中被否定的方案不得作为有效方法写入（可注明"讨论中曾提出的 X 方案被否定，因为……"）。
5. 未关联步骤的讨论若对整体有价值，融入最合适的位置并同样点出原始问题。
6. 数学公式必须用 LaTeX：行内公式用 $...$，独立公式用 $$...$$；禁止用 Unicode 上下标（如 x²、a₁）或裸文本表示公式。
只输出 JSON，格式：
{"explanation":"完整 Markdown 详解","summary":"一句话概述本详解"}`;

const REF_ONLY_LENGTH = 40;

export function buildExplanationMessages(context: ExplanationContextData): ChatMessage[] {
  const steps = context.steps;
  const stepById = new Map(steps.map((step) => [step.id, step]));

  // 轮次 → 关联步骤；首个关联步骤视为主步骤（挂全文），其余仅挂摘要
  const stepIdsByTurn = new Map<string, string[]>();
  for (const tag of context.tags) {
    if (!stepById.has(tag.stepId)) continue;
    const list = stepIdsByTurn.get(tag.turnId) ?? [];
    if (!list.includes(tag.stepId)) list.push(tag.stepId);
    stepIdsByTurn.set(tag.turnId, list);
  }

  const sections = steps.map((step) => {
    const lines: string[] = [];
    for (const turn of context.turns) {
      const tagged = stepIdsByTurn.get(turn.id) ?? [];
      if (tagged.length === 0) continue;
      const primaryStepId = tagged[0];
      if (primaryStepId === step.id) {
        lines.push(
          `  - 【轮次 ${turn.id}】用户：${turn.userMessage}\n    助手：${turn.assistantMessage}`,
        );
      } else if (tagged.includes(step.id)) {
        const primaryTitle = stepById.get(primaryStepId)?.title ?? "其他步骤";
        lines.push(
          `  - 【轮次 ${turn.id}·关联】用户曾问：${turn.userMessage.slice(0, REF_ONLY_LENGTH)}…（该讨论全文见步骤「${primaryTitle}」，如与本步骤相关请参考）`,
        );
      }
    }

    return `### 步骤「${step.title}」（${step.id}）\n${step.content}\n关联讨论：\n${
      lines.length > 0 ? lines.join("\n") : "  （本步骤暂无关联讨论）"
    }`;
  });

  const unlinked = context.turns
    .filter((turn) => (stepIdsByTurn.get(turn.id) ?? []).length === 0)
    .map((turn) => `  - 【轮次 ${turn.id}】用户：${turn.userMessage} / 助手：${turn.assistantMessage}`);

  const userContent = `# 题目
${context.question.content}

# 分步解答与各步骤关联讨论
${sections.join("\n\n")}

# 未关联步骤的讨论
${unlinked.length > 0 ? unlinked.join("\n") : "（无）"}`;

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];
}
