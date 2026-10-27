import { useEffect, useState } from "react";
import { AlertCircle, History, Loader2, RotateCcw } from "lucide-react";
import type { SolutionRevision, SolutionRevisionCreator } from "@motive/shared";
import type { WorkspaceApi } from "@/features/workspace/use-workspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Markdown } from "@/components/shared/markdown";
import { cn } from "@/lib/utils";

const creatorLabel: Record<SolutionRevisionCreator, string> = {
  ai: "AI 生成",
  manual: "手动调整",
  archive: "归档应用",
};

const creatorTone: Record<
  SolutionRevisionCreator,
  "neutral" | "brand" | "success" | "warning" | "danger"
> = {
  ai: "neutral",
  manual: "brand",
  archive: "success",
};

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("zh-CN", { hour12: false });
}

interface RevisionHistoryDialogProps {
  open: boolean;
  onClose: () => void;
  workspace: WorkspaceApi;
}

export function RevisionHistoryDialog({
  open,
  onClose,
  workspace,
}: RevisionHistoryDialogProps) {
  const { revisions, revisionsLoading, loadRevisions, restoreRevision, restoringRevision } =
    workspace;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelectedId(null);
    setConfirming(false);
    setError(null);
    void loadRevisions();
  }, [open, loadRevisions]);

  const selected: SolutionRevision | null =
    revisions.find((revision) => revision.id === selectedId) ??
    revisions[0] ??
    null;

  const handleRestore = async () => {
    if (!selected) return;
    setError(null);
    const message = await restoreRevision(selected.id);
    if (message) {
      setError(message);
      return;
    }
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="题解版本历史"
      description="每次生成、归档应用或恢复都会保存一个版本快照。"
      className="max-w-[820px]"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] text-ink-faint">
            {selected ? `当前选中第 ${selected.revisionNumber} 版` : "选择一个版本查看内容"}
          </span>
          {confirming ? (
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setConfirming(false)}
                disabled={restoringRevision}
              >
                取消
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void handleRestore()}
                disabled={restoringRevision}
              >
                {restoringRevision ? (
                  <Loader2 size={12.5} className="animate-spin" />
                ) : null}
                {restoringRevision ? "正在恢复…" : "确认恢复"}
              </Button>
            </div>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConfirming(true)}
              disabled={!selected || restoringRevision}
            >
              <RotateCcw size={12.5} strokeWidth={1.9} />
              恢复此版本
            </Button>
          )}
        </div>
      }
    >
      {confirming ? (
        <div className="mb-3 rounded-md border border-warning/35 bg-warning/10 px-2.5 py-2 text-[11.5px] leading-relaxed text-warning">
          恢复会用该版本重建题目步骤，并写入一个「手动调整」版本；该题下已建立的讨论会随旧步骤一并移除。
        </div>
      ) : null}

      {error ? (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-2.5 py-2 text-[11.5px] text-danger">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <span className="leading-relaxed">{error}</span>
        </div>
      ) : null}

      {revisionsLoading ? (
        <p className="flex items-center justify-center gap-2 py-10 text-[12px] text-ink-faint">
          <Loader2 size={13} className="animate-spin" />
          正在加载版本…
        </p>
      ) : revisions.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-3 py-8 text-center text-[12px] text-ink-faint">
          暂无版本记录。
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
          <div className="max-h-[420px] space-y-1 overflow-y-auto pr-1">
            {revisions.map((revision) => {
              const active = revision.id === selected?.id;
              return (
                <button
                  key={revision.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(revision.id);
                    setConfirming(false);
                    setError(null);
                  }}
                  className={cn(
                    "w-full rounded-lg border px-2.5 py-2 text-left transition-colors",
                    active
                      ? "border-brand/35 bg-selection/50"
                      : "border-line hover:border-line-strong hover:bg-elevated/40",
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <History size={11.5} className="shrink-0 text-ink-faint" />
                    <span className="text-[12px] font-semibold text-ink">
                      第 {revision.revisionNumber} 版
                    </span>
                    <Badge tone={creatorTone[revision.createdBy]} className="ml-auto">
                      {creatorLabel[revision.createdBy]}
                    </Badge>
                  </div>
                  <p className="mt-1 font-mono text-[10.5px] text-ink-faint">
                    {formatTime(revision.createdAt)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-faint">
                    {revision.steps.length} 个步骤
                  </p>
                </button>
              );
            })}
          </div>

          <div className="min-w-0">
            {selected ? (
              <div className="max-h-[420px] space-y-2.5 overflow-y-auto rounded-lg border border-line bg-elevated/30 px-3 py-2.5">
                {selected.steps.map((step, index) => (
                  <div key={`${selected.id}-${index}`}>
                    <p className="text-[12px] font-semibold text-ink">
                      {index + 1}. {step.title}
                    </p>
                    <div className="mt-1">
                      <Markdown content={step.content} className="md-compact" />
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </Dialog>
  );
}
