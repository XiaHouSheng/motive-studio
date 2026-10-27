import { isValidElement, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

function flattenText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join("");
  if (isValidElement(node)) {
    return flattenText((node.props as { children?: ReactNode }).children);
  }
  return "";
}

function significantChildren(children: ReactNode): ReactNode[] {
  const list = Array.isArray(children) ? children : [children];
  return list.filter((child) => !(typeof child === "string" && child.trim() === ""));
}

function languageOf(children: ReactNode): string | null {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (!isValidElement(child)) continue;
    const className = (child.props as { className?: string }).className;
    const match = /language-([\w-]+)/.exec(className ?? "");
    if (match) return match[1];
  }
  return null;
}

function CodeBlock({ children }: { children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const language = languageOf(children);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(flattenText(children).replace(/\n$/, ""));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="md-code">
      <div className="md-code-bar">
        <span className="font-mono text-[10.5px] tracking-[0.04em] text-ink-faint uppercase">
          {language ?? "code"}
        </span>
        <button type="button" onClick={copy} className="md-code-copy">
          {copied ? <Check size={11.5} strokeWidth={2.2} /> : <Copy size={11.5} strokeWidth={1.9} />}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

const components: Components = {
  p({ children }) {
    const parts = significantChildren(children);

    if (parts.length === 1 && isValidElement(parts[0])) {
      const child = parts[0];
      const childProps = child.props as { children?: ReactNode; className?: string };

      if (child.type === "strong") {
        return <p className="md-question">{children}</p>;
      }

      if (child.type === "code" && !childProps.className) {
        return (
          <p className="md-formula">
            <code>{childProps.children}</code>
          </p>
        );
      }
    }

    return <p>{children}</p>;
  },
  blockquote({ children }) {
    const isVerify = flattenText(children).includes("⚠️");
    return <blockquote className={isVerify ? "md-verify" : undefined}>{children}</blockquote>;
  },
  pre({ children }) {
    return <CodeBlock>{children}</CodeBlock>;
  },
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    );
  },
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

/**
 * 兼容 AI 常见的 LaTeX 分隔符：\(…\) 行内、\[…\] 块级。
 * remark-math 只识别 $…$ / $$…$$，模型不守约定时公式会原样显示，这里统一归一化。
 */
function normalizeMath(content: string): string {
  return normalizePlainFormulas(
    content
      .replace(/\\\(([\s\S]+?)\\\)/g, (_match, inner: string) => `$${inner}$`)
      .replace(/\\\[([\s\S]+?)\\\]/g, (_match, inner: string) => `$$${inner}$$`),
  );
}

interface MarkdownProps {
  content: string;
  className?: string;
}

export function Markdown({ content, className }: MarkdownProps) {
  return (
    <div className={cn("md", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={components}
      >
        {normalizeMath(content)}
      </ReactMarkdown>
    </div>
  );
}
