import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, Loader2 } from "lucide-react";
import type { PromptSettingsView, PromptStage } from "@motive/shared";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n/use-i18n";
import { translateApiError } from "@/lib/i18n/errors";
import type { DictionaryKey } from "@/lib/i18n/zh-CN";
import { cn } from "@/lib/utils";

/** 各 AI 环节：顺序与展示文案统一在此维护 */
const STAGES: Array<{
  stage: PromptStage;
  labelKey: DictionaryKey;
  descKey: DictionaryKey;
}> = [
  {
    stage: "image_import",
    labelKey: "prompts.stageImageImport",
    descKey: "prompts.descImageImport",
  },
  {
    stage: "solution_generation",
    labelKey: "prompts.stageSolutionGeneration",
    descKey: "prompts.descSolutionGeneration",
  },
  {
    stage: "step_discussion",
    labelKey: "prompts.stageStepDiscussion",
    descKey: "prompts.descStepDiscussion",
  },
  {
    stage: "explanation_generation",
    labelKey: "prompts.stageExplanationGeneration",
    descKey: "prompts.descExplanationGeneration",
  },
];

type StageStatus = "idle" | "saving" | "saved" | "error";

interface StageState {
  /** 编辑中的草稿（显式保存，不逐字符自动保存） */
  draft: string;
  /** 服务端当前生效的覆盖值（空串 = 默认） */
  saved: string;
  status: StageStatus;
  error: string | null;
}

function initialStages(): Record<PromptStage, StageState> {
  return {
    image_import: { draft: "", saved: "", status: "idle", error: null },
    solution_generation: { draft: "", saved: "", status: "idle", error: null },
    step_discussion: { draft: "", saved: "", status: "idle", error: null },
    explanation_generation: { draft: "", saved: "", status: "idle", error: null },
  };
}

function initialDefaults(): Record<PromptStage, boolean> {
  return {
    image_import: false,
    solution_generation: false,
    step_discussion: false,
    explanation_generation: false,
  };
}

const textareaClass =
  "min-h-[120px] w-full resize-y rounded-md border border-line bg-field px-2.5 py-2 font-mono text-[12px] leading-relaxed text-ink outline-none placeholder:text-ink-faint focus:border-brand/50";

const labelClass = "text-[11.5px] font-medium text-ink-soft";

/**
 * 提示词设置：各环节一张卡片。
 * - 显式保存（每卡「保存」按钮），不逐字符自动保存
 * - 卡片展示：未保存修改 / 保存中 / 保存成功 / 保存失败（失败保留草稿）
 * - 「查看默认提示词」渲染服务端返回的 defaults，前端不复制默认文案
 * - 「恢复默认」= 立即保存空串（不把默认文本写入数据库）
 */
export function PromptsSettings() {
  const t = useT();

  const [view, setView] = useState<PromptSettingsView | null>(null);
  const [stages, setStages] = useState<Record<PromptStage, StageState>>(initialStages);
  const [defaultOpen, setDefaultOpen] = useState<Record<PromptStage, boolean>>(initialDefaults);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    api
      .getPromptSettings()
      .then((next) => {
        if (cancelled) return;
        setView(next);
        setStages((prev) => {
          const merged = { ...prev };
          for (const { stage } of STAGES) {
            const saved = next.settings[stage] ?? "";
            merged[stage] = { ...prev[stage], draft: saved, saved };
          }
          return merged;
        });
      })
      .catch((loadFailure) => {
        if (!cancelled) {
          setLoadError(
            loadFailure instanceof Error
              ? translateApiError(t, loadFailure)
              : t("settings.loadPromptsFailed"),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [t]);

  const setDraft = useCallback((stage: PromptStage, draft: string) => {
    setStages((prev) => ({
      ...prev,
      [stage]: { ...prev[stage], draft, status: "idle", error: null },
    }));
  }, []);

  const save = useCallback(
    async (stage: PromptStage, value: string) => {
      setStages((prev) => ({
        ...prev,
        [stage]: { ...prev[stage], status: "saving", error: null },
      }));

      try {
        const next = await api.savePromptSettings({ [stage]: value });
        setView(next);
        setStages((prev) => ({
          ...prev,
          [stage]: {
            draft: value,
            saved: next.settings[stage] ?? "",
            status: "saved",
            error: null,
          },
        }));
      } catch (saveFailure) {
        setStages((prev) => ({
          ...prev,
          [stage]: {
            ...prev[stage],
            status: "error",
            error:
              saveFailure instanceof Error
                ? translateApiError(t, saveFailure)
                : t("settings.loadPromptsFailed"),
          },
        }));
      }
    },
    [t],
  );

  const restoreDefault = useCallback(
    (stage: PromptStage) => {
      if (!window.confirm(t("prompts.confirmRestore"))) return;
      void save(stage, "");
    },
    [save, t],
  );

  const toggleDefault = useCallback((stage: PromptStage) => {
    setDefaultOpen((prev) => ({ ...prev, [stage]: !prev[stage] }));
  }, []);

  if (loading) {
    return (
      <p className="py-6 text-[12px] text-ink-faint">{t("common.loading")}</p>
    );
  }

  if (loadError) {
    return (
      <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
        {loadError}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-[12px] leading-relaxed text-ink-soft">
        {t("settings.promptsIntro")}
      </p>

      {STAGES.map(({ stage, labelKey, descKey }) => {
        const state = stages[stage];
        const dirty = state.draft !== state.saved;
        const isDefault = state.saved === "";

        return (
          <section
            key={stage}
            className="space-y-2.5 rounded-lg border border-line bg-panel p-3.5"
            aria-label={t(labelKey)}
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="text-[13px] font-semibold text-ink">{t(labelKey)}</h3>
              {isDefault ? (
                <span className="rounded bg-selection px-1.5 py-0.5 text-[10px] text-ink-faint">
                  {t("prompts.defaultBadge")}
                </span>
              ) : (
                <span className="rounded bg-brand/10 px-1.5 py-0.5 text-[10px] text-brand">
                  {t("prompts.customizedBadge")}
                </span>
              )}
              <span className="ml-auto flex items-center gap-1.5 text-[10.5px] text-ink-faint">
                {state.status === "saving" ? (
                  <>
                    <Loader2 size={11} className="animate-spin" />
                    {t("prompts.savingBadge")}
                  </>
                ) : state.status === "saved" ? (
                  <>
                    <CheckCircle2 size={11} className="text-success" />
                    {t("prompts.savedBadge")}
                  </>
                ) : state.status === "error" ? (
                  <span className="text-danger">{t("prompts.saveFailedBadge")}</span>
                ) : dirty ? (
                  <span className="text-warning">{t("prompts.unsavedBadge")}</span>
                ) : null}
              </span>
            </div>
            <p className="text-[11px] text-ink-faint">{t(descKey)}</p>

            <label className="block space-y-1.5">
              <span className={labelClass}>{t("prompts.customPromptLabel")}</span>
              <textarea
                className={textareaClass}
                value={state.draft}
                onChange={(event) => setDraft(stage, event.target.value)}
                placeholder={t("prompts.customPromptPlaceholder")}
                spellCheck={false}
              />
            </label>

            {state.error ? (
              <p className="rounded-md border border-danger/30 bg-danger/10 px-2.5 py-1.5 text-[11.5px] text-danger">
                {state.error}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void save(stage, state.draft)}
                disabled={state.status === "saving" || !dirty}
                className="inline-flex h-7 items-center rounded-md bg-brand px-3 text-[11.5px] font-medium text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("common.save")}
              </button>
              <button
                type="button"
                onClick={() => restoreDefault(stage)}
                disabled={state.status === "saving"}
                className="inline-flex h-7 items-center rounded-md border border-line bg-field px-3 text-[11.5px] text-ink-soft transition-colors hover:bg-selection hover:text-ink disabled:opacity-50"
              >
                {t("prompts.restoreDefault")}
              </button>
              <button
                type="button"
                onClick={() => toggleDefault(stage)}
                aria-expanded={defaultOpen[stage]}
                className={cn(
                  "ml-auto inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-ink-faint transition-colors hover:bg-selection hover:text-ink",
                )}
              >
                <ChevronDown
                  size={12}
                  className={cn(
                    "transition-transform",
                    defaultOpen[stage] ? "rotate-180" : undefined,
                  )}
                />
                {defaultOpen[stage] ? t("prompts.hideDefault") : t("prompts.viewDefault")}
              </button>
            </div>

            {defaultOpen[stage] && view ? (
              <div className="space-y-1 rounded-md border border-line bg-field/60 p-2.5">
                <span className="block text-[10.5px] font-medium uppercase tracking-[0.06em] text-ink-faint">
                  {t("prompts.defaultPromptLabel")}
                </span>
                <pre className="max-h-[240px] overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed text-ink-soft">
                  {view.defaults[stage]}
                </pre>
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
