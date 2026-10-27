import { cn } from "@/lib/utils";

export function ThinkingDots({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-end gap-1", className)} aria-label="正在思考">
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
