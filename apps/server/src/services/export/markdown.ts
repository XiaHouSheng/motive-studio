import type { Question, SolutionExplanation, SolutionStep } from "@motive/shared";

export interface QuestionExportInput {
  groupTitle: string;
  question: Question;
  steps: SolutionStep[];
  explanations: SolutionExplanation[];
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatExportTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const INVALID_FILENAME_CHARS = /[\\/:*?"<>|\r\n\t]/g;

export function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(INVALID_FILENAME_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  return cleaned.length > 0 ? cleaned.slice(0, 60) : "motive-export";
}

/** 题目标题取题干去掉 Markdown 符号后的前段文字 */
function questionTitle(question: Question): string {
  const plain = question.content
    .replace(/[#*_`>]/g, " ")
    .replace(/\$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.slice(0, 24).trim() || "未命名题目";
}

export function buildQuestionFilename(input: QuestionExportInput): string {
  return sanitizeFilename(`题目详解-${questionTitle(input.question)}.md`);
}

export function buildGroupFilename(groupTitle: string): string {
  return sanitizeFilename(`题组详解-${groupTitle}.md`);
}

/** 渲染题目详解与分步题解两个小节，heading 层级由调用方决定 */
function renderQuestionSections(input: QuestionExportInput, level: number): string[] {
  const section = "#".repeat(level);
  const entry = "#".repeat(level + 1);
  const lines: string[] = [];

  const explanations = input.explanations.filter(
    (explanation) => explanation.status === "completed" && explanation.content.trim().length > 0,
  );

  lines.push(`${section} 题目详解`, "");
  if (explanations.length === 0) {
    lines.push("_暂无已完成的题目详解。_", "");
  } else {
    explanations.forEach((explanation, index) => {
      lines.push(
        `${entry} 详解 ${index + 1} · ${formatExportTime(explanation.createdAt)}`,
        "",
        explanation.summary.trim(),
        "",
        explanation.content.trim(),
        "",
      );
    });
  }

  lines.push(`${section} 分步题解`, "");
  if (input.steps.length === 0) {
    lines.push("_尚未生成分步题解。_", "");
  } else {
    input.steps.forEach((step, index) => {
      lines.push(
        `${entry} 第 ${index + 1} 步：${step.title.trim()}`,
        "",
        step.content.trim(),
        "",
      );
    });
  }

  return lines;
}

export function buildQuestionMarkdown(
  input: QuestionExportInput,
  exportedAt: number = Date.now(),
): string {
  const lines: string[] = [
    "# 题目详解",
    "",
    `> 题组：${input.groupTitle} · 导出时间：${formatExportTime(exportedAt)}`,
    "",
    "## 题目",
    "",
    input.question.content.trim(),
    "",
    ...renderQuestionSections(input, 2),
  ];

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

export function buildGroupMarkdown(
  groupTitle: string,
  questions: QuestionExportInput[],
  exportedAt: number = Date.now(),
): string {
  const lines: string[] = [
    `# ${groupTitle}`,
    "",
    `> 共 ${questions.length} 道题目 · 导出时间：${formatExportTime(exportedAt)}`,
    "",
  ];

  if (questions.length === 0) {
    lines.push("_该题组暂无题目。_", "");
  } else {
    questions.forEach((input, index) => {
      if (index > 0) lines.push("---", "");
      lines.push(
        `## 第 ${index + 1} 题`,
        "",
        input.question.content.trim(),
        "",
        ...renderQuestionSections(input, 3),
      );
    });
  }

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}
