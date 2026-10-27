import type {
  ConversationTurn,
  Question,
  QuestionGroup,
  SolutionExplanation,
  SolutionStep,
  SubConversation,
  TurnStepTag,
  WorkspaceData,
} from "@motive/shared";

const BASE = new Date("2026-10-24T09:20:00+08:00").getTime();
const minutes = (value: number) => BASE + value * 60_000;

const questionQuad = "已知函数 $f(x)=x^{2}-6x+5$，求它在区间 $[0,4]$ 上的最大值与最小值。";
const questionTangent = "求曲线 $y=x^{3}-3x$ 在点 $(1,-2)$ 处的切线方程。";
const questionLimit = "求极限 $\\displaystyle\\lim_{x\\to 0}\\frac{\\sin 3x}{x}$。";
const questionInequality = "证明：当 $x>0$ 时，$\\ln(1+x) < x$。";

const explanationQuad = `## 第一步：先把函数的结构看清楚

对二次函数，配方是最直接的入口。把原式整理成顶点式：

\`f(x) = (x−3)² − 4\`

配方之后可以直接读出对称轴 $x=3$ 与顶点 $(3,-4)$，后续所有判断都建立在这个结论上。

**问：为什么配方之后就能直接看出最小值？**

因为 $(x-3)^2 \\ge 0$ 恒成立，所以 $f(x)=(x-3)^2-4 \\ge -4$，等号在 $x=3$ 时取得。这就是最小值 $-4$ 的来源，不需要再求导。

## 第二步：区间让问题变得不一样

**问：为什么一定要比较端点和顶点的值？**

在有界区间上，连续函数的最值只可能在区间内部的驻点或区间的端点处取得。顶点是候选，端点同样是候选，漏掉任何一类都可能得到错误答案。

## 第三步：算出全部候选值

三个候选值分别是：

- 顶点：$f(3)=-4$
- 左端点：$f(0)=5$
- 右端点：$f(4)=-3$

## 第四步：比较候选值

比较之后，最小值是 $-4$，最大值是 $5$。要注意的是，最大值并不在右端点，而在左端点 $x=0$。

> ⚠️ 待验证：若把区间改为 $[3,4]$，最大值会变成 $f(4)=-3$，此时顶点同时是最小值点。可以自行验证一次。`;

const stepsQuad: SolutionStep[] = [
  {
    id: "s-quad-1",
    questionId: "q-quad",
    order: 1,
    title: "配方并读出顶点",
    content: `二次函数开口向上，先配方：

$$
f(x)=x^{2}-6x+5=(x-3)^{2}-4
$$

由此得到对称轴 $x=3$，顶点坐标为 $(3,-4)$。`,
    updatedAt: minutes(0),
  },
  {
    id: "s-quad-2",
    questionId: "q-quad",
    order: 2,
    title: "判断顶点与区间的关系",
    content: `题目给定区间 $[0,4]$。因为

$$
0 \\le 3 \\le 4
$$

所以顶点落在区间内部，必须作为候选最值点参与比较。`,
    updatedAt: minutes(1),
  },
  {
    id: "s-quad-3",
    questionId: "q-quad",
    order: 3,
    title: "计算顶点处的函数值",
    content: `把 $x=3$ 代入顶点式：

\`f(3) = (3−3)² − 4 = −4\`

由于抛物线开口向上，这个值在区间内部是最小值的候选。`,
    updatedAt: minutes(2),
  },
  {
    id: "s-quad-4",
    questionId: "q-quad",
    order: 4,
    title: "计算两个端点的值",
    content: `分别把端点代入原函数：

- 左端点：$f(0)=0-0+5=5$
- 右端点：$f(4)=16-24+5=-3$`,
    updatedAt: minutes(3),
  },
  {
    id: "s-quad-5",
    questionId: "q-quad",
    order: 5,
    title: "比较候选值并下结论",
    content: `三个候选值是 $-4$、$5$、$-3$。比较得到：

$$
\\min_{[0,4]} f(x) = -4, \\qquad \\max_{[0,4]} f(x) = 5
$$

最小值在 $x=3$ 处取得，最大值在 $x=0$ 处取得。`,
    updatedAt: minutes(4),
  },
];

const stepsTangent: SolutionStep[] = [
  {
    id: "s-tan-1",
    questionId: "q-tangent",
    order: 1,
    title: "确认点在曲线上",
    content: `把 $x=1$ 代入 $y=x^{3}-3x$，得到 $1-3=-2$，因此点 $(1,-2)$ 确实在曲线上，可以直接作为切点。`,
    updatedAt: minutes(20),
  },
  {
    id: "s-tan-2",
    questionId: "q-tangent",
    order: 2,
    title: "求导得到切线斜率",
    content: `对 $y=x^{3}-3x$ 求导：

$$
y'=3x^{2}-3
$$

在 $x=1$ 处，$y'=3-3=0$，所以切线斜率为 $0$。`,
    updatedAt: minutes(21),
  },
  {
    id: "s-tan-3",
    questionId: "q-tangent",
    order: 3,
    title: "写出切线方程",
    content: `切线经过点 $(1,-2)$ 且斜率为 $0$，因此方程为

\`y = -2\`

即一条水平直线。`,
    updatedAt: minutes(22),
  },
  {
    id: "s-tan-4",
    questionId: "q-tangent",
    order: 4,
    title: "用几何意义检查",
    content: `$y'$ 在 $x=1$ 两侧由负变正，说明该点是局部极小值点，水平切线与图形相符。`,
    updatedAt: minutes(23),
  },
];

export function createSeedWorkspace(): WorkspaceData {
  const groups: QuestionGroup[] = [
    {
      id: "g-math",
      title: "函数与导数",
      questionIds: ["q-quad", "q-tangent"],
      createdAt: minutes(0),
      updatedAt: minutes(24),
    },
    {
      id: "g-calc",
      title: "极限与不等式",
      questionIds: ["q-limit", "q-inequality"],
      createdAt: minutes(30),
      updatedAt: minutes(36),
    },
  ];

  const questions: Question[] = [
    {
      id: "q-quad",
      groupId: "g-math",
      content: questionQuad,
      solutionStepIds: stepsQuad.map((step) => step.id),
      createdAt: minutes(0),
      updatedAt: minutes(5),
    },
    {
      id: "q-tangent",
      groupId: "g-math",
      content: questionTangent,
      solutionStepIds: stepsTangent.map((step) => step.id),
      createdAt: minutes(18),
      updatedAt: minutes(24),
    },
    {
      id: "q-limit",
      groupId: "g-calc",
      content: questionLimit,
      solutionStepIds: [],
      createdAt: minutes(30),
      updatedAt: minutes(30),
    },
    {
      id: "q-inequality",
      groupId: "g-calc",
      content: questionInequality,
      solutionStepIds: [],
      createdAt: minutes(34),
      updatedAt: minutes(34),
    },
  ];

  const turns: ConversationTurn[] = [
    {
      id: "t-1",
      subConversationId: "sub-quad-2",
      userMessage: "为什么一定要比较端点和顶点的值？",
      assistantMessage: `因为这题的定义区间是有界的 $[0,4]$。闭区间上的连续函数，最值只可能出现在两类位置：区间内部的驻点（这里是顶点 $x=3$），以及区间的两个端点。

顶点给出 $-4$，两个端点分别给出 $5$ 和 $-3$。只有把三类候选值放在一起比较，才能确定最大值是 $5$。

如果只算顶点，就会漏掉更大的端值。`,
      createdAt: minutes(6),
      archiveStatus: "unarchived",
      tagStatus: "tagged",
    },
    {
      id: "t-2",
      subConversationId: "sub-quad-2",
      userMessage: "如果顶点不在区间内呢？",
      assistantMessage: `那时函数在整个区间上单调，最值一定在端点取得。

例如把区间改成 $[4,6]$，对称轴 $x=3$ 落在区间外，$f$ 在 $[4,6]$ 上单调递增，所以只需要比较 $f(4)$ 和 $f(6)$。`,
      createdAt: minutes(8),
      archiveStatus: "unarchived",
      tagStatus: "tagged",
    },
    {
      id: "t-3",
      subConversationId: "sub-quad-2",
      userMessage: "配方这一步我总是弄错符号，有什么检查办法？",
      assistantMessage: `最快的检查方式是把配方结果展开回去：

\`(x−3)² − 4 = x² − 6x + 9 − 4 = x² − 6x + 5\`

展开后与原式一致，说明配方没有错。

另外可以记住：一次项系数 $-6$ 的一半是 $-3$，平方后是 $9$，所以常数项要减掉 $9$ 再加回原来的 $5$。`,
      createdAt: minutes(11),
      archiveStatus: "unarchived",
      tagStatus: "pending",
    },
    {
      id: "t-4",
      subConversationId: "sub-quad-5",
      userMessage: "最大值为什么不是右端点？",
      assistantMessage: `因为右端点 $x=4$ 处的值是 $f(4)=-3$，而左端点 $f(0)=5$ 更大。

最大值是在全部候选值里挑最大的，不是默认取右端点。`,
      createdAt: minutes(13),
      archiveStatus: "archived",
      tagStatus: "tagged",
    },
  ];

  const tags: TurnStepTag[] = [
    {
      id: "tag-1",
      turnId: "t-1",
      stepId: "s-quad-2",
      relevance: "讨论区间最值的候选点来源",
      createdAt: minutes(6),
    },
    {
      id: "tag-2",
      turnId: "t-1",
      stepId: "s-quad-5",
      relevance: "涉及候选值比较的结论",
      createdAt: minutes(6),
    },
    {
      id: "tag-3",
      turnId: "t-2",
      stepId: "s-quad-2",
      relevance: "继续讨论顶点与区间的位置关系",
      createdAt: minutes(8),
    },
    {
      id: "tag-4",
      turnId: "t-4",
      stepId: "s-quad-5",
      relevance: "比较候选值时的误区",
      createdAt: minutes(13),
    },
    {
      id: "tag-5",
      turnId: "t-4",
      stepId: "s-quad-4",
      relevance: "涉及端点值的计算",
      createdAt: minutes(13),
    },
  ];

  const subs: SubConversation[] = [
    {
      id: "sub-quad-2",
      entryStepId: "s-quad-2",
      turnIds: ["t-1", "t-2", "t-3"],
      createdAt: minutes(5),
      updatedAt: minutes(11),
    },
    {
      id: "sub-quad-5",
      entryStepId: "s-quad-5",
      turnIds: ["t-4"],
      createdAt: minutes(12),
      updatedAt: minutes(13),
    },
  ];

  const explanations: SolutionExplanation[] = [
    {
      id: "exp-quad-1",
      questionId: "q-quad",
      content: explanationQuad,
      summary: "以配方为起点，结合区间端点比较，得出最大值与最小值。",
      status: "completed",
      turnIds: ["t-4"],
      createdAt: minutes(14),
      usage: { inputTokens: 1840, outputTokens: 620 },
    },
  ];

  return {
    groups,
    questions,
    steps: [...stepsQuad, ...stepsTangent],
    subs,
    turns,
    tags,
    explanations,
  };
}
