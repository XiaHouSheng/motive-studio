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

/**
 * 兼容 AI 常见的 LaTeX 分隔符：\(…\) 行内、\[…\] 块级。
 * remark-math 只识别 $…$ / $$…$$，模型不守约定时公式会原样显示，这里统一归一化。
 */
function normalizeMath(content: string): string {
  return content
    .replace(/\\\(([\s\S]+?)\\\)/g, (_match, inner: string) => `$${inner}$`)
    .replace(/\\\[([\s\S]+?)\\\]/g, (_match, inner: string) => `$$${inner}$$`);
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
