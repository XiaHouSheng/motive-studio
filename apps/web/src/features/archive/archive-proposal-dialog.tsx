import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowRight, Loader2 } from "lucide-react";
import type { ArchiveAction } from "@motive/shared";
import type { WorkspaceApi } from "@/features/workspace/use-workspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Markdown } from "@/components/shared/markdown";

const actionMeta: Record<
  ArchiveAction,
  { label: string; tone: "neutral" | "brand" | "success" | "danger" | "warning" }
> = {
  add_explanation: { label: "追加说明", tone: "brand" },
  revise_content: { label: "重写内容", tone: "warning" },
  no_change: { label: "无需修改", tone: "neutral" },
  needs_review: { label: "需人工确认", tone: "danger" },
};

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 90 ? `${flat.slice(0, 90)}…` : flat;
}

interface ArchiveProposalDialogProps {
  workspace: WorkspaceApi;
}

export function ArchiveProposalDialog({ workspace }: ArchiveProposalDialogProps) {
  const {
    pendingProposal,
    steps,
    turns,
    archiveDialogOpen,
    archiveApplying,
    closeArchiveDialog,
    applyArchive,
    rejectArchive,
  } = workspace;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (archiveDialogOpen) setError(null);
  }, [archiveDialogOpen, pendingProposal?.id]);

  const turnById = useMemo(() => {
    const map = new Map<string, (typeof turns)[number]>();
    for (const turn of turns) map.set(turn.id, turn);
    return map;
  }, [turns]);

  if (!pendingProposal) return null;

  const effectiveCount = pendingProposal.changes.filter(
    (change) => change.action === "add_explanation" || change.action === "revise_content",
  ).length;

  const handleApply = async () => {
    setError(null);
    const message = await applyArchive();
    if (message) setError(message);
  };

  const handleReject = async () => {
    setError(null);
    const message = await rejectArchive();
    if (message) setError(message);
  };

  return (
    <Dialog
      open={archiveDialogOpen}
      onClose={closeArchiveDialog}
      title="归档提案预览"
      description="确认后才会写入正式题解，应用过程会生成新版本。"
      className="max-w-[720px]"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] text-ink-faint">
            {effectiveCount > 0
              ? `${effectiveCount} 项变更将写入正式题解`
              : "本次没有需要写入的变更"}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleReject()}
              disabled={archiveApplying}
            >
              拒绝提案
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleApply()}
              disabled={archiveApplying}
            >
              {archiveApplying ? (
                <Loader2 size={12.5} className="animate-spin" />
              ) : null}
              {archiveApplying ? "正在应用…" : "确认应用"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="rounded-lg border border-line bg-elevated/40 px-3 py-2.5">
          <p className="text-[10.5px] font-semibold tracking-[0.08em] text-ink-faint uppercase">
            提案概述
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-soft">
            {pendingProposal.summary}
          </p>
        </div>

        {error ? (
          <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-2.5 py-2 text-[11.5px] text-danger">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            <span className="leading-relaxed">{error}</span>
          </div>
        ) : null}

        {pendingProposal.changes.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-[12px] text-ink-faint">
            讨论暂未产生需要修改的正式内容。
          </p>
        ) : (
          <div className="space-y-2.5">
            {pendingProposal.changes.map((change, index) => {
              const step = steps.find((item) => item.id === change.stepId);
              const meta = actionMeta[change.action];
              const effective =
                change.action === "add_explanation" ||
                change.action === "revise_content";
              const preview =
                change.action === "add_explanation" && step && change.proposedContent
                  ? `${step.content}\n\n${change.proposedContent}`
                  : change.proposedContent;
              const sources = change.sourceTurnIds
                .map((turnId) => turnById.get(turnId))
                .filter((turn): turn is NonNullable<typeof turn> => Boolean(turn));

              return (
                <div
                  key={`${change.stepId}-${index}`}
                  className="rounded-lg border border-line bg-panel px-3 py-2.5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">
                      {step ? `${step.order}. ${step.title}` : "步骤已不存在"}
                    </span>
                  </div>

                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-faint">
                    {change.rationale}
                  </p>

                  {effective && preview ? (
                    <div className="mt-2 space-y-2">
                      {change.action === "revise_content" && step ? (
                        <div>
                          <p className="text-[10px] font-semibold tracking-[0.08em] text-ink-faint uppercase">
                            当前内容
                          </p>
                          <div className="mt-1 max-h-[120px] overflow-y-auto rounded-md border border-line/70 bg-elevated/40 px-2.5 py-2 opacity-70">
                            <Markdown content={step.content} className="md-compact" />
                          </div>
                        </div>
                      ) : null}
                      <div>
                        <p className="flex items-center gap-1 text-[10px] font-semibold tracking-[0.08em] text-ink-faint uppercase">
                          {change.action === "add_explanation" ? (
                            <>
                              将追加
                              <ArrowRight size={9.5} />
                            </>
                          ) : (
                            "提案后内容"
                          )}
                        </p>
                        <div className="mt-1 max-h-[200px] overflow-y-auto rounded-md border border-brand/30 bg-brand/5 px-2.5 py-2">
                          <Markdown content={preview} className="md-compact" />
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {sources.length > 0 ? (
                    <div className="mt-2 space-y-1">
                      <p className="text-[10px] font-semibold tracking-[0.08em] text-ink-faint uppercase">
                        来源讨论
                      </p>
                      {sources.map((turn) => (
                        <div
                          key={turn.id}
                          className="rounded-md border border-line/70 bg-elevated/40 px-2.5 py-1.5 text-[11px] leading-relaxed text-ink-faint"
                        >
                          <span className="text-ink-soft">用户：</span>
                          {excerpt(turn.userMessage)}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Dialog>
  );
}
