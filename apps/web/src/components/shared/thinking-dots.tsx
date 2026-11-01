import { useT } from "@/lib/i18n/use-i18n";
import { cn } from "@/lib/utils";

export function ThinkingDots({ className }: { className?: string }) {
  const t = useT();
  return (
    <span className={cn("inline-flex items-end gap-1", className)} aria-label={t("ui.thinking")}>
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className="thinking-dot h-1.5 w-1.5 rounded-full bg-brand"
          style={{ animationDelay: `${index * 0.16}s` }}
        />
      ))}
    </span>
  );
}
