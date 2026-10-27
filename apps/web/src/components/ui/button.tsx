import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "icon" | "icon-sm";

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-brand text-white shadow-sm hover:bg-brand-hover disabled:hover:bg-brand dark:text-[#06201d]",
  secondary:
    "border border-line bg-panel text-ink hover:border-line-strong hover:bg-elevated disabled:text-ink-faint",
  ghost: "text-ink-soft hover:bg-selection hover:text-ink disabled:text-ink-faint",
  danger: "text-danger hover:bg-danger/10 disabled:text-ink-faint",
};

const sizeClasses: Record<Size, string> = {
  sm: "h-7 gap-1.5 rounded-md px-2.5 text-[12.5px]",
  md: "h-9 gap-2 rounded-lg px-3.5 text-[13px]",
  icon: "h-8 w-8 rounded-lg",
  "icon-sm": "h-6 w-6 rounded-md",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  type = "button",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center font-medium transition-colors duration-150 select-none disabled:cursor-not-allowed",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
