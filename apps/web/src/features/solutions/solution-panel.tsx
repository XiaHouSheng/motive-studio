import { useState } from "react";
import {
  AlertCircle,
  Archive,
  BookOpen,
  ChevronDown,
  CircleHelp,
  Download,
  History,
  ListChecks,
  Loader2,
  Sparkles,
} from "lucide-react";
import type { ExplanationStatus, SolutionExplanation } from "@motive/shared";
import { useUiStore } from "@/stores/ui";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { WorkspaceApi } from "@/features/workspace/use-workspace";
import { Markdown } from "@/components/shared/markdown";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { StepCard } from "./step-card";
import { RevisionHistoryDialog } from "./revision-history-dialog";

const statusMeta: Record<ExplanationStatus, { label: string; tone: "neutral" | "brand" | "success" | "danger" | "warning" }> = {
  pending: { label: "等待执行", tone: "neutral" },
  processing: { label: "正在生成", tone: "brand" },
  completed: { label: "已完成", tone: "success" },
  failed: { label: "生成失败", tone: "danger" },
};

function ExplanationCard({
  explanation,
  index,
  defaultOpen,
}: {
  explanation: SolutionExplanation;
  index: number;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const meta = statusMeta[explanation.status];

  return (
    <article className="rounded-xl border border-brand/40 bg-brand/8 transition-colors">
      <div className="flex items-start gap-3 px-4 pt-3.5 pb-1">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-brand/45 bg-brand/15 font-mono text-[11px] tabular-nums text-brand">
          {index + 1}
        </span>

        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[13.5px] leading-snug font-semibold text-ink">题目详解</h3>
            <Badge tone={meta.tone}>{meta.label}</Badge>
            <span className="text-[11px] text-ink-faint">
              {formatTime(explanation.createdAt)}
            </span>
          </div>
        </div>

        <Button variant="ghost" size="sm" onClick={() => setOpen((value) => !value)}>
          <ChevronDown
            size={13}
            className={cn("transition-transform duration-150", open && "rotate-180")}
          />
          {open ? "收起" : "展开"}
        </Button>
      </div>

      <div className="px-4 pb-3.5 sm:pl-[52px]">
        <p className="text-[13px] leading-[1.75] text-ink-soft">{explanation.summary}</p>
        {open ? (
          <div className="mt-2.5 border-t border-brand/15 pt-2.5">
            <Markdown content={explanation.content} className="md-compact" />
          </div>
        ) : null}
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-faint">
          <span>纳入 {explanation.turnIds.length} 轮讨论</span>
          {explanation.usage ? (
            <span>
              消耗 {explanation.usage.inputTokens} 输入 / {explanation.usage.outputTokens} 输出
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}

interface SolutionPanelProps {
  workspace: WorkspaceApi;
}

export function SolutionPanel({ workspace }: SolutionPanelProps) {
  const {
    loading,
    question,
    steps,
    explanations,
    tagCountByStep,
    selectedGroup,
    generatingSolution,
    solutionError,
    generateSolution,
    pendingProposal,
    openArchiveDialog,
    exportQuestionMarkdown,
  } = workspace;
  const activeStepId = useUiStore((state) => state.activeStepId);
  const openDiscussion = useUiStore((state) => state.openDiscussion);
  const openSettings = useUiStore((state) => state.openSettings);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [revisionOpen, setRevisionOpen] = useState(false);

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[780px] space-y-6 px-6 py-8 lg:px-10">
        <Skeleton className="h-3 w-20" />
        <div className="space-y-2.5">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-4/5" />
        </div>
        <Skeleton className="h-24 w-full rounded-xl" />
        <div className="space-y-2.5 pt-4">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (!question) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <EmptyState
          icon={BookOpen}
          title={selectedGroup ? "选择一个题目开始" : "选择或新建一个题组"}
          description={
            selectedGroup
              ? "从左侧题目列表中选择一道题，正式题解与讨论会显示在这里。"
              : "题组和题目都在左侧导航中管理。"
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[780px] px-5 pt-7 pb-20 sm:px-8 lg:px-10">
      <div className="flex items-center gap-2 text-[10.5px] font-semibold tracking-[0.1em] text-ink-faint uppercase">
        <span>题目</span>
        {selectedGroup ? (
          <span className="font-normal tracking-normal normal-case">· {selectedGroup.title}</span>
        ) : null}
      </div>

      <Markdown content={question.content} className="md-question-title mt-2.5" />

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11.5px] text-ink-faint">
        <span>{steps.length > 0 ? `${steps.length} 个步骤` : "尚无步骤"}</span>
        <span className="h-3 w-px bg-line" />
        <span>更新于 {formatTime(question.updatedAt)}</span>
        {steps.length > 0 ? (
          <Badge tone="success" className="ml-1">
            正式题解已生成
          </Badge>
        ) : null}
      </div>

      {pendingProposal ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-brand/30 bg-brand/8 px-3 py-2.5">
          <Archive size={13} strokeWidth={1.9} className="shrink-0 text-brand" />
          <span className="text-[12px] font-medium text-ink-soft">
            有 {pendingProposal.changes.length} 项待确认的归档提案
          </span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-ink-faint">
            {pendingProposal.summary}
          </span>
          <Button variant="secondary" size="sm" onClick={openArchiveDialog}>
            查看提案
          </Button>
        </div>
      ) : null}

      <section className="mt-8">
        <div className="mb-2.5 flex items-center gap-2">
          <h2 className="text-[12px] font-semibold tracking-[0.06em] text-ink-soft">题目详解</h2>
          <span className="text-[11px] text-ink-faint">融入了讨论中的疑问</span>
          <div className="ml-auto">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => exportQuestionMarkdown(question.id)}
              title="导出本题详解与分步题解（Markdown）"
            >
              <Download size={13} strokeWidth={1.9} />
              导出
            </Button>
          </div>
        </div>
        {explanations.length > 0 ? (
          <div className="space-y-2.5">
            {explanations.slice(0, 5).map((explanation, index) => (
              <ExplanationCard
                key={explanation.id}
                explanation={explanation}
                index={index}
                defaultOpen={index === 0}
              />
            ))}
          </div>
        ) : (
          <div className="flex items-start gap-2.5 rounded-xl border border-dashed border-line px-4 py-3.5">
            <CircleHelp size={15} strokeWidth={1.8} className="mt-0.5 shrink-0 text-ink-faint" />
            <div className="space-y-0.5">
              <p className="text-[12.5px] font-medium text-ink-soft">尚无详解</p>
              <p className="text-[12px] leading-relaxed text-ink-faint">
                在步骤讨论中追问你的疑问，之后可在这里生成一份融入讨论的完整详解。
              </p>
            </div>
          </div>
        )}
      </section>

      <section className="mt-8">
        <div className="mb-2.5 flex items-center gap-2">
          <h2 className="text-[12px] font-semibold tracking-[0.06em] text-ink-soft">分步题解</h2>
          {steps.length > 0 ? (
            <span className="text-[11px] text-ink-faint">共 {steps.length} 步</span>
          ) : null}
          {steps.length > 0 ? (
            <div className="ml-auto flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRevisionOpen(true)}
                disabled={generatingSolution}
              >
                <History size={13} strokeWidth={1.9} />
                版本历史
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setConfirmOpen(true)}
                disabled={generatingSolution}
              >
                {generatingSolution ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Sparkles size={13} />
                )}
                {generatingSolution ? "正在重新生成…" : "重新生成"}
              </Button>
            </div>
          ) : null}
        </div>

        {solutionError ? (
          <div className="mb-2.5 flex flex-wrap items-center gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[11.5px] text-danger">
            <AlertCircle size={13} className="shrink-0" />
            <span className="min-w-0 flex-1">{solutionError.message}</span>
            {solutionError.code === "INVALID_CONFIG" ? (
              <button
                type="button"
                onClick={openSettings}
                className="shrink-0 font-medium underline underline-offset-2 transition-opacity hover:opacity-80"
              >
                配置模型
              </button>
            ) : null}
          </div>
        ) : null}

        {steps.length > 0 ? (
          <div className="space-y-2.5">
            {steps.map((step) => (
              <StepCard
                key={step.id}
                step={step}
                active={step.id === activeStepId}
                discussionCount={tagCountByStep[step.id] ?? 0}
                onDiscuss={openDiscussion}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2.5">
            <EmptyState
              icon={ListChecks}
              title="尚未生成正式题解"
              description="生成分步题解后，就可以围绕不懂的步骤展开讨论。"
              compact
              className="rounded-xl border border-dashed border-line"
            />
            <div className="flex justify-center">
              <Button
                variant="primary"
                size="sm"
                onClick={() => void generateSolution()}
                disabled={generatingSolution}
              >
                {generatingSolution ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Sparkles size={13} />
                )}
                {generatingSolution ? "正在生成题解…" : "生成分步题解"}
              </Button>
            </div>
          </div>
        )}
      </section>

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="重新生成题解？"
        description={`将覆盖当前 ${steps.length} 个步骤，并删除这些步骤下的全部讨论记录，此操作不可撤销。`}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setConfirmOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setConfirmOpen(false);
                void generateSolution();
              }}
            >
              <Sparkles size={13} />
              确认重新生成
            </Button>
          </div>
        }
      >
        <p className="text-[12px] leading-relaxed text-ink-soft">
          生成过程会调用当前配置的模型，完成后正式题解将被新步骤替换。
        </p>
      </Dialog>

      <RevisionHistoryDialog
        open={revisionOpen}
        onClose={() => setRevisionOpen(false)}
        workspace={workspace}
      />
    </div>
  );
}
