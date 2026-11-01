import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowRight, Loader2 } from "lucide-react";
import type { ArchiveAction } from "@motive/shared";
import type { WorkspaceApi } from "@/features/workspace/use-workspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Markdown } from "@/components/shared/markdown";
import { useT } from "@/lib/i18n/use-i18n";
import type { DictionaryKey } from "@/lib/i18n/zh-CN";

const actionMeta: Record<
  ArchiveAction,
  { labelKey: DictionaryKey; tone: "neutral" | "brand" | "success" | "danger" | "warning" }
> = {
  add_explanation: { labelKey: "archive.actionAddExplanation", tone: "brand" },
  revise_content: { labelKey: "archive.actionReviseContent", tone: "warning" },
  no_change: { labelKey: "archive.actionNoChange", tone: "neutral" },
  needs_review: { labelKey: "archive.actionNeedsReview", tone: "danger" },
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
  const t = useT();

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
      title={t("archive.title")}
      description={t("archive.description")}
      className="max-w-[720px]"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] text-ink-faint">
            {effectiveCount > 0
              ? t("archive.changeCount", { count: effectiveCount })
              : t("archive.noChanges")}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleReject()}
              disabled={archiveApplying}
            >
              {t("archive.reject")}
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
              {archiveApplying ? t("archive.applying") : t("archive.apply")}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="rounded-lg border border-line bg-elevated/40 px-3 py-2.5">
          <p className="text-[10.5px] font-semibold tracking-[0.08em] text-ink-faint uppercase">
            {t("archive.overview")}
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
            {t("archive.empty")}
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
                    <Badge tone={meta.tone}>{t(meta.labelKey)}</Badge>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">
                      {step ? `${step.order}. ${step.title}` : t("archive.stepMissing")}
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
                            {t("archive.currentContent")}
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
                              {t("archive.willAppend")}
                              <ArrowRight size={9.5} />
                            </>
                          ) : (
                            t("archive.proposedContent")
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
                        {t("archive.sourceTurns")}
                      </p>
                      {sources.map((turn) => (
                        <div
                          key={turn.id}
                          className="rounded-md border border-line/70 bg-elevated/40 px-2.5 py-1.5 text-[11px] leading-relaxed text-ink-faint"
                        >
                          <span className="text-ink-soft">{t("archive.userLabel")}</span>
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
