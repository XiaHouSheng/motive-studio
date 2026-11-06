import { useState } from "react";
import {
  AlertCircle,
  BookOpen,
  ChevronDown,
  CircleHelp,
  Download,
  History,
  ListChecks,
  Loader2,
  Sparkles,
} from "lucide-react";
import type {
  ExplanationStatus,
  ImagePolicy,
  QuestionAsset,
  SolutionExplanation,
  SolutionStep,
} from "@motive/shared";
import { useUiStore } from "@/stores/ui";
import { useI18n } from "@/lib/i18n/use-i18n";
import type { DictionaryKey } from "@/lib/i18n/zh-CN";
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
import { StepEditDialog } from "./step-edit-dialog";
import { RevisionHistoryDialog } from "./revision-history-dialog";

const policyLabels: Record<ImagePolicy, DictionaryKey> = {
  auto: "solution.policy.auto",
  always: "solution.policy.always",
  never: "solution.policy.never",
};

const statusMeta: Record<
  ExplanationStatus,
  { label: DictionaryKey; tone: "neutral" | "brand" | "success" | "danger" | "warning" }
> = {
  pending: { label: "solution.status.pending", tone: "neutral" },
  processing: { label: "solution.status.processing", tone: "brand" },
  completed: { label: "solution.status.completed", tone: "success" },
  failed: { label: "solution.status.failed", tone: "danger" },
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
  const { t, locale } = useI18n();
  const meta = statusMeta[explanation.status];

  return (
    <article className="rounded-xl border border-brand/40 bg-brand/8 transition-colors">
      <div className="flex items-start gap-3 px-4 pt-3.5 pb-1">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-brand/45 bg-brand/15 font-mono text-[11px] tabular-nums text-brand">
          {index + 1}
        </span>

        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[13.5px] leading-snug font-semibold text-ink">
              {t("solution.explanation.title")}
            </h3>
            <Badge tone={meta.tone}>{t(meta.label)}</Badge>
            <span className="text-[11px] text-ink-faint">
              {formatTime(explanation.createdAt, locale)}
            </span>
          </div>
        </div>

        <Button variant="ghost" size="sm" onClick={() => setOpen((value) => !value)}>
          <ChevronDown
            size={13}
            className={cn("transition-transform duration-150", open && "rotate-180")}
          />
          {open ? t("solution.collapse") : t("solution.expand")}
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
          <span>{t("solution.explanation.turns", { count: explanation.turnIds.length })}</span>
          {explanation.usage ? (
            <span>
              {t("solution.explanation.usage", {
                input: explanation.usage.inputTokens,
                output: explanation.usage.outputTokens,
              })}
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
    generatingExplanation,
    explanationError,
    generateExplanation,
    exportQuestionMarkdown,
    providerSupportsVision,
    setQuestionImagePolicy,
  } = workspace;
  const activeStepId = useUiStore((state) => state.activeStepId);
  const openDiscussion = useUiStore((state) => state.openDiscussion);
  const openSettings = useUiStore((state) => state.openSettings);
  const { t, locale } = useI18n();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [editingStep, setEditingStep] = useState<SolutionStep | null>(null);
  const [previewAsset, setPreviewAsset] = useState<QuestionAsset | null>(null);

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
          title={selectedGroup ? t("solution.empty.selectQuestion") : t("solution.empty.selectGroup")}
          description={
            selectedGroup
              ? t("solution.empty.selectQuestionDesc")
              : t("solution.empty.selectGroupDesc")
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[780px] px-5 pt-7 pb-20 sm:px-8 lg:px-10">
      <div className="flex items-center gap-2 text-[10.5px] font-semibold tracking-[0.1em] text-ink-faint uppercase">
        <span>{t("solution.question.label")}</span>
        {selectedGroup ? (
          <span className="font-normal tracking-normal normal-case">· {selectedGroup.title}</span>
        ) : null}
      </div>

      <div key={question.id} className="animate-fade-in">
        <Markdown content={question.content} className="md-question-title mt-2.5" />
      </div>

      {question.assets.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {question.assets.map((asset) => (
            <button
              key={asset.id}
              type="button"
              onClick={() => setPreviewAsset(asset)}
              title={t("solution.asset.viewOriginal")}
              className="h-16 w-16 overflow-hidden rounded-md border border-line bg-field transition-colors hover:border-brand/50"
            >
              <img
                src={asset.url}
                alt={t("solution.asset.original")}
                loading="lazy"
                className="h-full w-full object-cover"
              />
            </button>
          ))}
          <label className="ml-auto inline-flex items-center gap-1.5 text-[11.5px] text-ink-faint">
            {t("solution.asset.imageLabel")}
            <select
              value={question.imagePolicy}
              onChange={(event) =>
                setQuestionImagePolicy(question.id, event.target.value as ImagePolicy)
              }
              className="h-7 rounded-md border border-line bg-field px-1.5 text-[11.5px] text-ink-soft outline-none focus:border-brand/50"
            >
              {(Object.keys(policyLabels) as ImagePolicy[]).map((policy) => (
                <option key={policy} value={policy}>
                  {t(policyLabels[policy])}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {question.imagePolicy === "always" && providerSupportsVision === false ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[11.5px] text-warning">
          <AlertCircle size={13} className="shrink-0" />
          <span className="min-w-0 flex-1">{t("solution.warning.vision")}</span>
          <button
            type="button"
            onClick={openSettings}
            className="shrink-0 font-medium underline underline-offset-2 transition-opacity hover:opacity-80"
          >
            {t("solution.warning.openSettings")}
          </button>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11.5px] text-ink-faint">
        <span>
          {steps.length > 0
            ? t("solution.steps.count", { count: steps.length })
            : t("solution.steps.none")}
        </span>
        <span className="h-3 w-px bg-line" />
        <span>{t("solution.updatedAt", { time: formatTime(question.updatedAt, locale) })}</span>
        {steps.length > 0 ? (
          <Badge tone="success" className="ml-1">
            {t("solution.badge.generated")}
          </Badge>
        ) : null}
      </div>

      <section className="mt-8">
        <div className="mb-2.5 flex items-center gap-2">
          <h2 className="text-[12px] font-semibold tracking-[0.06em] text-ink-soft">
            {t("solution.explanation.title")}
          </h2>
          <span className="text-[11px] text-ink-faint">{t("solution.explanation.subtitle")}</span>
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => exportQuestionMarkdown(question.id)}
              title={t("solution.export.title")}
            >
              <Download size={13} strokeWidth={1.9} />
              {t("solution.export.action")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void generateExplanation()}
              disabled={generatingExplanation || steps.length === 0}
              title={
                steps.length === 0
                  ? t("solution.explanation.needSteps")
                  : t("solution.explanation.tooltip")
              }
            >
              {generatingExplanation ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Sparkles size={13} />
              )}
              {generatingExplanation
                ? t("solution.explanation.generating")
                : explanations.length > 0
                  ? t("solution.explanation.regenerate")
                  : t("solution.explanation.generate")}
            </Button>
          </div>
        </div>
        {explanationError ? (
          <div className="mb-2.5 flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[11.5px] leading-relaxed text-danger">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            <span className="min-w-0 flex-1">{explanationError}</span>
          </div>
        ) : null}
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
              <p className="text-[12.5px] font-medium text-ink-soft">
                {t("solution.explanation.empty.title")}
              </p>
              <p className="text-[12px] leading-relaxed text-ink-faint">
                {t("solution.explanation.empty.description")}
              </p>
            </div>
          </div>
        )}
      </section>

      <section className="mt-8">
        <div className="mb-2.5 flex items-center gap-2">
          <h2 className="text-[12px] font-semibold tracking-[0.06em] text-ink-soft">
            {t("solution.section.steps")}
          </h2>
          {steps.length > 0 ? (
            <span className="text-[11px] text-ink-faint">
              {t("solution.steps.total", { count: steps.length })}
            </span>
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
                {t("solution.history.action")}
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
                {generatingSolution ? t("solution.regenerating") : t("solution.regenerate")}
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
                {t("solution.error.configureModel")}
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
                onEdit={(stepId) => {
                  const target = steps.find((item) => item.id === stepId);
                  if (target) setEditingStep(target);
                }}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2.5">
            <EmptyState
              icon={ListChecks}
              title={t("solution.empty.noSolution")}
              description={t("solution.empty.noSolutionDesc")}
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
                {generatingSolution ? t("solution.generating") : t("solution.generate")}
              </Button>
            </div>
          </div>
        )}
      </section>

      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t("solution.confirm.title")}
        description={t("solution.confirm.description", { count: steps.length })}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setConfirmOpen(false)}>
              {t("solution.cancel")}
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
              {t("solution.confirm.action")}
            </Button>
          </div>
        }
      >
        <p className="text-[12px] leading-relaxed text-ink-soft">
          {t("solution.confirm.body")}
        </p>
      </Dialog>

      <Dialog
        open={previewAsset !== null}
        onClose={() => setPreviewAsset(null)}
        title={t("solution.asset.original")}
        className="max-w-[820px]"
      >
        {previewAsset ? (
          <img
            src={previewAsset.url}
            alt={t("solution.asset.original")}
            className="mx-auto max-h-[70vh] w-auto rounded-lg border border-line"
          />
        ) : null}
      </Dialog>

      <RevisionHistoryDialog
        open={revisionOpen}
        onClose={() => setRevisionOpen(false)}
        workspace={workspace}
      />

      {editingStep ? (
        <StepEditDialog
          step={editingStep}
          onClose={() => setEditingStep(null)}
          onSave={workspace.updateStep}
        />
      ) : null}
    </div>
  );
}
