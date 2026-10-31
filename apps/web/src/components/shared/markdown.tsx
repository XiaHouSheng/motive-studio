import { isValidElement, type ReactNode } from "react";
import { Streamdown } from "streamdown";
import type { Components, StreamdownTranslations } from "streamdown";
import { createMathPlugin } from "@streamdown/math";
import type { Element } from "hast";
import { cn } from "@/lib/utils";

function flattenText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (isValidElement(node)) {
    return flattenText((node.props as { children?: ReactNode }).children);
  }
  return "";
}

/** 段落里唯一有效子节点（跳过空白文本），用于识别整行强调/公式 */
function soleElement(node: Element | undefined): Element | null {
  if (!node) return null;
  const significant = node.children.filter(
    (child) => child.type === "element" || (child.type === "text" && child.value.trim() !== ""),
  );
  if (significant.length !== 1) return null;
  return significant[0].type === "element" ? significant[0] : null;
}

const components: Components = {
  p({ children, node }) {
    const child = soleElement(node);

    if (child?.tagName === "strong") {
      return <p className="md-question">{children}</p>;
    }

    if (child?.tagName === "code") {
      return (
        <p className="md-formula">
          <code>{flattenText(children)}</code>
        </p>
      );
    }

    return <p>{children}</p>;
  },
  blockquote({ children }) {
    const isVerify = flattenText(children).includes("⚠️");
    return <blockquote className={isVerify ? "md-verify" : undefined}>{children}</blockquote>;
  },
};

/** 行内公式开关需显式打开，否则 $…$ 不会被解析 */
const math = createMathPlugin({
  singleDollarTextMath: true,
  errorColor: "var(--warning)",
});

const translations: Partial<StreamdownTranslations> = {
  copyCode: "复制",
  copied: "已复制",
  copyTable: "复制表格",
  downloadTable: "下载表格",
};

const SUPERSCRIPT_MAP: Record<string, string> = {
  "⁰": "0",
  "¹": "1",
  "²": "2",
  "³": "3",
  "⁴": "4",
  "⁵": "5",
  "⁶": "6",
  "⁷": "7",
  "⁸": "8",
  "⁹": "9",
  "⁺": "+",
  "⁻": "-",
  "⁼": "=",
  "⁽": "(",
  "⁾": ")",
};

const SUBSCRIPT_MAP: Record<string, string> = {
  "₀": "0",
  "₁": "1",
  "₂": "2",
  "₃": "3",
  "₄": "4",
  "₅": "5",
  "₆": "6",
  "₇": "7",
  "₈": "8",
  "₉": "9",
  "₊": "+",
  "₋": "-",
  "₌": "=",
  "₍": "(",
  "₎": ")",
};

const SUPERSCRIPT_RUN = /[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾]+/g;
const SUBSCRIPT_RUN = /[₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎]+/g;
/** 形如 x²-6x+5、aₙ 这类不带分隔符的纯文本公式片段 */
const PLAIN_FORMULA_TOKEN = /[A-Za-z0-9()+\-*/=<>×÷−.,[\]⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎]{2,}/g;
const VERBATIM_SEGMENT = /(```[\s\S]*?```|`[^`\n]*`|\$\$[\s\S]*?\$\$|\$[^$\n]*\$|\[[^\]]*\]\([^)]*\))/g;
const SCRIPT_CHAR = /[⁰¹²³⁴⁵⁶⁷⁸⁹₀₁₂₃₄₅₆₇₈₉]/;

function unicodeScriptToLatex(token: string): string {
  return token
    .replace(SUPERSCRIPT_RUN, (run) => `^{${[...run].map((char) => SUPERSCRIPT_MAP[char] ?? "").join("")}}`)
    .replace(SUBSCRIPT_RUN, (run) => `_{${[...run].map((char) => SUBSCRIPT_MAP[char] ?? "").join("")}}`)
    .replace(/\u00d7/g, "\\times ")
    .replace(/\u00f7/g, "\\div ")
    .replace(/\u2212/g, "-");
}

/** 判定纯文本片段是否值得当公式处理；宁可漏判，也不要把英文单词、文件名误当公式 */
function looksLikeFormula(token: string): boolean {
  if (SCRIPT_CHAR.test(token)) return true;
  if (/[=*×÷^]/.test(token)) return true;
  // 除法形式（如 -b/(2a)、6/2）需同时含数字，避免把 TCP/IP 之类的词当公式
  return token.includes("/") && /\d/.test(token);
}

/**
 * AI 有时把公式写成纯文本（如 x²-6x+5、x=3），KaTeX 无法识别。
 * 只处理「连续符号片段」并跳过代码、已有公式与链接，避免误伤正文。
 */
function normalizePlainFormula(segment: string): string {
  return segment.replace(PLAIN_FORMULA_TOKEN, (token) => {
    const trimmed = token.replace(/[.,]+$/, "");
    if (!looksLikeFormula(trimmed)) return token;
    return `$${unicodeScriptToLatex(trimmed)}$${token.slice(trimmed.length)}`;
  });
}

function normalizePlainFormulas(content: string): string {
  return content
    .split(VERBATIM_SEGMENT)
    .map((part) => (/^(```|`|\$)/.test(part) ? part : normalizePlainFormula(part)))
    .join("");
}

/** 含这些结构的公式在行内会明显撑高行距，更适合独占一行展示 */
const DISPLAY_MATH_HINT = /\\frac|\\dfrac|\\tfrac|\\sum|\\int|\\lim|\\begin\{|\\displaystyle/;

function shouldPromoteToDisplay(body: string): boolean {
  const formula = body.trim();
  if (formula.length < 18) return false;
  if (DISPLAY_MATH_HINT.test(formula)) return true;
  if (formula.length >= 60) return true;
  // 多个等式串联（如 a=b=c）也按块级处理，避免行内过宽
  return (formula.match(/=/g)?.length ?? 0) >= 2 && formula.length >= 30;
}

function promoteLongFormula(piece: string): string {
  if (piece.startsWith("$$")) {
    if (!piece.startsWith("$$\n")) {
      // 单行 $$…$$ 会被 remark-math 当成行内公式，改成多行块级写法
      const body = piece.slice(2, -2).trim();
      if (body) return `\n\n$$\n${body}\n$$\n\n`;
    }
    return piece;
  }
  if (!piece.startsWith("$")) return piece;
  const body = piece.slice(1, -1);
  if (!shouldPromoteToDisplay(body)) return piece;
  return `\n\n$$\n${body.trim()}\n$$\n\n`;
}

/** 把长公式提升为块级，并把紧随其后的标点移回上一段，避免出现孤立的「，」开头 */
function splitLongFormulas(content: string): string {
  const parts = content.split(VERBATIM_SEGMENT);

  for (let index = 1; index < parts.length; index += 2) {
    const original = parts[index];
    const promoted = promoteLongFormula(original);
    if (promoted === original) continue;
    parts[index] = promoted;

    const following = parts[index + 1];
    const leading = following?.match(/^([ \t]*)([，。；：、,.;:])/);
    if (!following || !leading) continue;

    // 只在公式前已有正文时移动标点，避免把标点丢到空段
    const previous = parts[index - 1] ?? "";
    const trailing = /[ \t\n]*$/.exec(previous)?.[0] ?? "";
    const body = previous.slice(0, previous.length - trailing.length);
    if (body.trim() === "") continue;

    parts[index - 1] = `${body}${leading[2]}${trailing}`;
    parts[index + 1] = following.slice(leading[1].length + leading[2].length);
  }

  return parts.join("");
}

/**
 * Markdown 会把单个换行折叠成空格，而 AI 常按行罗列推导，导致多行被挤成一段。
 * 这里把行内单换行转成硬换行（两个空格 + 换行），代码与公式片段保持原样。
 */
function addSoftBreaks(content: string): string {
  return content
    .split(VERBATIM_SEGMENT)
    .map((part, index) =>
      index % 2 === 1 ? part : part.replace(/([^\n])\n(?=[^\n])/g, "$1  \n"),
    )
    .join("");
}

/**
 * 兼容 AI 常见的 LaTeX 分隔符：\(…\) 行内、\[…\] 块级。
 * remark-math 只识别 $…$ / $$…$$，模型不守约定时公式会原样显示，这里统一归一化。
 */
function normalizeMath(content: string): string {
  return splitLongFormulas(
    normalizePlainFormulas(
      content
        .replace(/\\\(([\s\S]+?)\\\)/g, (_match, inner: string) => `$${inner}$`)
        .replace(/\\\[([\s\S]+?)\\\]/g, (_match, inner: string) => `\n\n$$\n${inner}\n$$\n\n`),
    ),
  );
}

interface MarkdownProps {
  content: string;
  className?: string;
}

export function Markdown({ content, className }: MarkdownProps) {
  return (
    <div className={cn("md", className)}>
      <Streamdown
        className="md-streamdown"
        components={components}
        plugins={{ math }}
        translations={translations}
      >
        {addSoftBreaks(normalizeMath(content))}
      </Streamdown>
    </div>
  );
}
