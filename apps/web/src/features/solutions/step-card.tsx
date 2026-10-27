import { MessageCircle, MessageSquarePlus } from "lucide-react";
import type { SolutionStep } from "@motive/shared";
import { Markdown } from "@/components/shared/markdown";
import { cn } from "@/lib/utils";

interface StepCardProps {
  step: SolutionStep;
  active: boolean;
  discussionCount: number;
  onDiscuss: (stepId: string) => void;
}

export function StepCard({ step, active, discussionCount, onDiscuss }: StepCardProps) {
  return (
    <article
      className={cn(
        "group/step rounded-xl border bg-panel transition-colors duration-150",
        active
          ? "border-brand/35 bg-selection/35"
          : "border-line hover:border-line-strong",
      )}
    >
      <div className="flex items-start gap-3 px-4 pt-3.5 pb-1">
        <span
          className={cn(
            "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] tabular-nums transition-colors",
            active
              ? "border-brand/45 bg-brand text-white dark:text-[#062b27]"
              : "border-line bg-elevated text-ink-faint",
          )}
        >
          {step.order}
        </span>

        <h3 className="min-w-0 flex-1 pt-0.5 text-[13.5px] leading-snug font-semibold text-ink">
          {step.title}
        </h3>

        <button
          type="button"
          onClick={() => onDiscuss(step.id)}
          className={cn(
            "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[11.5px] font-medium transition-colors",
            active
              ? "bg-brand/10 text-brand"
              : "text-ink-soft opacity-100 hover:bg-selection hover:text-ink md:opacity-0 md:group-hover/step:opacity-100 md:focus-visible:opacity-100",
          )}
        >
          <MessageSquarePlus size={13} strokeWidth={1.9} />
          {active ? "讨论中" : "进入讨论"}
        </button>
      </div>

      <div className="px-4 pb-3.5 sm:pl-[52px]">
        <Markdown content={step.content} className="md-compact" />
        {discussionCount > 0 ? (
          <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-ink-faint">
            <MessageCircle size={11.5} strokeWidth={1.9} />
            {discussionCount} 轮讨论关联此步
          </div>
        ) : null}
      </div>
    </article>
  );
}
