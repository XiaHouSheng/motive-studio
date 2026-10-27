import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
  compact?: boolean;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
  className,
  compact = false,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "gap-2 px-5 py-8" : "gap-3 px-6 py-16",
        className,
      )}
    >
      <div
        className={cn(
          "flex items-center justify-center rounded-xl border border-line bg-elevated text-ink-faint",
          compact ? "h-9 w-9" : "h-11 w-11",
        )}
      >
        <Icon size={compact ? 16 : 19} strokeWidth={1.8} />
      </div>
      <div className="space-y-1">
        <p className={cn("font-medium text-ink", compact ? "text-[13px]" : "text-[13.5px]")}>
          {title}
        </p>
        {description ? (
          <p className="mx-auto max-w-[36ch] text-[12.5px] leading-relaxed text-ink-soft">
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </div>
  );
}
