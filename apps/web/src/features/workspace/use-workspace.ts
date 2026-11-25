import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  TurnImage,
  Question,
  SolutionRevision,
  SolutionStep,
  TurnGenerationStatus,
  TurnTagStatus,
  WorkspaceData,
} from "@motive/shared";
import { replaceStepReferences } from "@motive/shared";
import { useUiStore } from "@/stores/ui";
import { ApiError, api } from "@/lib/api";
import { useT } from "@/lib/i18n/use-i18n";
import { translateApiError } from "@/lib/i18n/errors";

/** 发送讨论消息时携带的附图（前端已缩放的 base64） */
export interface StreamImage {
  mediaType: string;
  data: string;
}

export interface ChatTag {
  stepId: string;
  title: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  tagStatus?: TurnTagStatus;
  generationStatus?: TurnGenerationStatus;
  tags: ChatTag[];
  streaming?: boolean;
  failed?: boolean;
  /** 用户消息附图：已落库轮次用服务端 URL，流式/发送失败时用本地 data URL */
  images?: TurnImage[];
}

interface StreamingState {
  userMessage: string;
  assistantText: string;
  startedAt: number;
  stopping: boolean;
  images?: TurnImage[];
}

interface FailedSend {
  userMessage: string;
  message: string;
  startedAt: number;
  images?: TurnImage[];
}

const EMPTY_WORKSPACE: WorkspaceData = {
  groups: [],
  paperGroups: [],
  questions: [],
  steps: [],
  subs: [],
  turns: [],
  tags: [],
  explanations: [],
};

/** 工作区数据的轻量签名：题组/题目清单与其 updatedAt，数据变化时必然改变 */
function dataSignature(data: WorkspaceData): string {
  const groups = data.groups.map((group) => `${group.id}:${group.updatedAt}`).join("|");
  const questions = data.questions
    .map((question) => `${question.id}:${question.updatedAt}`)
    .join("|");
  return `${data.groups.length}#${groups}#${data.questions.length}#${questions}`;
}

export function useWorkspace() {
  const t = useT();
  const [data, setData] = useState<WorkspaceData>(EMPTY_WORKSPACE);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streamingByStep, setStreamingByStep] = useState<Record<string, StreamingState>>({});
  const [failedSendByStep, setFailedSendByStep] = useState<Record<string, FailedSend>>({});
  const [generatingSolutionFor, setGeneratingSolutionFor] = useState<string | null>(null);
  const [solutionError, setSolutionError] = useState<{
    message: string;
    code?: string;
  } | null>(null);
  const [generatingExplanation, setGeneratingExplanation] = useState(false);
  const [explanationError, setExplanationError] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<SolutionRevision[]>([]);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const [restoringRevision, setRestoringRevision] = useState(false);
  const [imageImportGroupId, setImageImportGroupId] = useState<string | null>(null);
  /** 统一添加题目弹窗的目标试卷分组（题组之下的二级分组） */
  const [imageImportPaperGroupId, setImageImportPaperGroupId] = useState<string | null>(null);
  /** 统一添加题目弹窗的初始页签：文字添加 / 图片导入 */
  const [imageImportTab, setImageImportTab] = useState<"text" | "image">("text");
  const [imageImportAnalyzing, setImageImportAnalyzing] = useState(false);
  const [imageImportCreating, setImageImportCreating] = useState(false);
  const [imageImportError, setImageImportError] = useState<string | null>(null);
  const [imageImportQuestions, setImageImportQuestions] = useState<string[]>([]);
  const [mobileLinkOpen, setMobileLinkOpen] = useState(false);
  const [mobileLinkLoading, setMobileLinkLoading] = useState(false);
  const [mobileLinkError, setMobileLinkError] = useState<string | null>(null);
  const [mobileLinkUrls, setMobileLinkUrls] = useState<string[]>([]);
  const [providerSupportsVision, setProviderSupportsVision] = useState<boolean | null>(null);
  const controllers = useRef<Map<string, AbortController>>(new Map());
  const lastLoadAt = useRef(0);

  const selectedGroupId = useUiStore((state) => state.selectedGroupId);
  const selectedPaperGroupId = useUiStore((state) => state.selectedPaperGroupId);
  const selectedQuestionId = useUiStore((state) => state.selectedQuestionId);
  const activeStepId = useUiStore((state) => state.activeStepId);
  const initializeSelection = useUiStore((state) => state.initializeSelection);
  const resetSelection = useUiStore((state) => state.resetSelection);

  // 错误 → 用户提示：已知 ApiError 错误码走词典翻译，未知错误保留原始消息
  const toMessage = useCallback(
    (error: unknown): string => {
      if (error instanceof Error) return translateApiError(t, error);
      return t("workspace.operationFailed");
    },
    [t],
  );

  const load = useCallback(async (initial = false, onlyIfChanged = false) => {
    if (initial) {
      setLoading(true);
      setFatalError(null);
    }
    try {
      const next = await api.bootstrap();
      setData((current) => {
        // 轮询场景下内容未变化时不重渲染，避免打断当前操作
        if (onlyIfChanged && dataSignature(current) === dataSignature(next)) return current;
        return next;
      });
      lastLoadAt.current = Date.now();
      setFatalError(null);
    } catch (loadError) {
      const message = toMessage(loadError);
      if (initial) setFatalError(message);
      throw loadError;
    } finally {
      if (initial) setLoading(false);
    }
  }, [toMessage]);

  useEffect(() => {
    void load(true).catch(() => undefined);
  }, [load]);

  // 图片策略 always 且模型不支持视觉时需要提示用户
  useEffect(() => {
    let cancelled = false;
    void api
      .getProviderSettings()
      .then((view) => {
        if (!cancelled) setProviderSupportsVision(view.provider.supportsVision !== false);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // 手机导入弹窗打开期间：窗口聚焦/切回标签页时刷新，并每 4 秒轮询一次，
  // 手机提交后无需手动刷新即可看到新题目（内容未变化时静默跳过）
  useEffect(() => {
    let disposed = false;
    const maybeRefresh = (onlyIfChanged: boolean) => {
      if (disposed) return;
      if (Date.now() - lastLoadAt.current < 3000) return;
      lastLoadAt.current = Date.now();
      void load(false, onlyIfChanged).catch(() => undefined);
    };
    const handleFocus = () => maybeRefresh(false);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") maybeRefresh(false);
    };
    const pollId = mobileLinkOpen ? window.setInterval(() => maybeRefresh(true), 4000) : null;
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      disposed = true;
      if (pollId !== null) window.clearInterval(pollId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [mobileLinkOpen, load]);

  useEffect(() => {
    const active = controllers.current;
    return () => {
      for (const controller of active.values()) controller.abort();
      active.clear();
    };
  }, []);

  const run = useCallback(async (action: () => Promise<void>) => {
    try {
      await action();
      setError(null);
    } catch (actionError) {
      setError(toMessage(actionError));
    }
  }, [toMessage]);

  const retry = useCallback(() => {
    void load(true).catch(() => undefined);
  }, [load]);

  const dismissError = useCallback(() => setError(null), []);

  const groups = data.groups;
  const paperGroups = data.paperGroups ?? [];

  /** 当前题组下的试卷分组列表 */
  const paperGroupsInSelectedGroup = useMemo(
    () => paperGroups.filter((paper) => paper.groupId === selectedGroupId),
    [paperGroups, selectedGroupId],
  );

  /**
   * 生效的试卷分组：显式选中且属于当前题组时用选中项，
   * 否则回落到题组首个试卷分组（未选择/旧数据场景）。
   */
  const selectedPaperGroup = useMemo(() => {
    const list = paperGroupsInSelectedGroup;
    if (list.length === 0) return null;
    const explicit = list.find((paper) => paper.id === selectedPaperGroupId);
    return explicit ?? list[0];
  }, [paperGroupsInSelectedGroup, selectedPaperGroupId]);

  const questionsInGroup = useMemo(() => {
    if (!selectedGroupId) return [];
    const group = data.groups.find((item) => item.id === selectedGroupId);
    if (!group) return [];
    // 题目展示范围跟随生效的试卷分组；历史数据 paperGroupId 为空时按首个试卷分组兜底
    const fallbackPaperId = paperGroupsInSelectedGroup[0]?.id ?? null;
    return group.questionIds
      .map((id) => data.questions.find((question) => question.id === id))
      .filter((question): question is Question => {
        if (!question) return false;
        const paperId = question.paperGroupId ?? fallbackPaperId;
        return paperId === selectedPaperGroup?.id;
      });
  }, [data.groups, data.questions, selectedGroupId, paperGroupsInSelectedGroup, selectedPaperGroup]);

  // 数据变化后恢复选择：题组/题目被删除或导入后自动落到第一个可用项
  useEffect(() => {
    if (loading || fatalError) return;

    const currentGroup = groups.find((group) => group.id === selectedGroupId);

    if (!currentGroup) {
      const firstGroup = groups[0];
      if (!firstGroup) {
        if (selectedGroupId || selectedQuestionId || activeStepId) resetSelection();
        return;
      }
      initializeSelection(firstGroup.id, firstGroup.questionIds[0] ?? null);
      return;
    }

    if (selectedQuestionId && currentGroup.questionIds.includes(selectedQuestionId)) return;
    initializeSelection(currentGroup.id, currentGroup.questionIds[0] ?? null);
  }, [
    loading,
    fatalError,
    groups,
    selectedGroupId,
    selectedQuestionId,
    activeStepId,
    initializeSelection,
    resetSelection,
  ]);

  const selectedGroup = useMemo(
    () => data.groups.find((group) => group.id === selectedGroupId),
    [data.groups, selectedGroupId],
  );

  const question = useMemo(
    () => data.questions.find((item) => item.id === selectedQuestionId),
    [data.questions, selectedQuestionId],
  );

  const steps = useMemo(() => {
    if (!question) return [];
    return question.solutionStepIds
      .map((id) => data.steps.find((step) => step.id === id))
      .filter((step): step is SolutionStep => Boolean(step))
      .sort((a, b) => a.order - b.order);
  }, [data.steps, question]);

  const explanations = useMemo(() => {
    if (!question) return [];
    return data.explanations
      .filter((explanation) => explanation.questionId === question.id)
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [data.explanations, question]);

  const activeStep = useMemo(
    () => steps.find((step) => step.id === activeStepId),
    [steps, activeStepId],
  );

  const activeSub = useMemo(
    () => (activeStep ? data.subs.find((sub) => sub.entryStepId === activeStep.id) : undefined),
    [data.subs, activeStep],
  );

  const stepTitles = useMemo(() => {
    const map = new Map<string, string>();
    for (const step of data.steps) map.set(step.id, step.title);
    return map;
  }, [data.steps]);

  const messages = useMemo<ChatMessage[]>(() => {
    if (!activeStep) return [];

    const pairs: ChatMessage[] = [];
    if (activeSub) {
      for (const turnId of activeSub.turnIds) {
        const turn = data.turns.find((item) => item.id === turnId);
        if (!turn) continue;

        const tags = data.tags
          .filter((tag) => tag.turnId === turn.id && stepTitles.has(tag.stepId))
          .map((tag) => ({ stepId: tag.stepId, title: stepTitles.get(tag.stepId) ?? "" }));

        pairs.push({
          id: `${turn.id}-user`,
          role: "user",
          content: turn.userMessage,
          createdAt: turn.createdAt,
          tags: [],
          images: turn.images,
        });
        pairs.push({
          id: `${turn.id}-assistant`,
          role: "assistant",
          // 兜底清洗：存量消息正文可能含模型输出的步骤 UUID，渲染为「步骤 N（标题）」
          content: replaceStepReferences(turn.assistantMessage, data.steps),
          createdAt: turn.createdAt,
          tagStatus: turn.tagStatus,
          generationStatus: turn.generationStatus,
          tags,
        });
      }
    }

    const streaming = streamingByStep[activeStep.id];
    if (streaming) {
      pairs.push({
        id: `stream-${activeStep.id}-user`,
        role: "user",
        content: streaming.userMessage,
        createdAt: streaming.startedAt,
        tags: [],
        streaming: true,
        images: streaming.images,
      });
      if (streaming.assistantText) {
        pairs.push({
          id: `stream-${activeStep.id}-assistant`,
          role: "assistant",
          // 流式文本同样清洗（UUID 跨 chunk 时短暂保持原样，完整后即替换）
          content: replaceStepReferences(streaming.assistantText, data.steps),
          createdAt: streaming.startedAt + 1,
          tags: [],
          streaming: true,
        });
      }
    }

    const failed = failedSendByStep[activeStep.id];
    if (failed) {
      pairs.push({
        id: `failed-${activeStep.id}-user`,
        role: "user",
        content: failed.userMessage,
        createdAt: failed.startedAt,
        tags: [],
        failed: true,
        images: failed.images,
      });
    }

    return pairs.sort((a, b) => a.createdAt - b.createdAt);
  }, [
    activeSub,
    activeStep,
    data.tags,
    data.turns,
    failedSendByStep,
    stepTitles,
    streamingByStep,
  ]);

  const streaming = activeStep ? streamingByStep[activeStep.id] : undefined;
  const sendFailed = activeStep ? failedSendByStep[activeStep.id] : undefined;
  const thinking = Boolean(streaming && !streaming.assistantText);

  const tagCountByStep = useMemo(() => {
    const counts: Record<string, number> = {};
    const seen = new Set<string>();
    for (const tag of data.tags) {
      const key = `${tag.turnId}:${tag.stepId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      counts[tag.stepId] = (counts[tag.stepId] ?? 0) + 1;
    }
    return counts;
  }, [data.tags]);

  const runStream = useCallback(
    async (stepId: string, text: string, images?: StreamImage[]) => {
      setFailedSendByStep((prev) => {
        if (!(stepId in prev)) return prev;
        const next = { ...prev };
        delete next[stepId];
        return next;
      });

      const controller = new AbortController();
      controllers.current.set(stepId, controller);

      const startedAt = Date.now();
      setStreamingByStep((prev) => ({
        ...prev,
        [stepId]: {
          userMessage: text,
          assistantText: "",
          startedAt,
          stopping: false,
          images: images?.map((image) => ({
            assetId: "",
            mimeType: image.mediaType,
            url: `data:${image.mediaType};base64,${image.data}`,
          })),
        },
      }));

      const outcome: { error?: string; receivedEvent: boolean; receivedText: boolean } = {
        receivedEvent: false,
        receivedText: false,
      };
      let failure: string | null = null;

      try {
        await api.streamMessage(stepId, text, {
          images,
          signal: controller.signal,
          onEvent: (event) => {
            outcome.receivedEvent = true;
            if (event.type === "text-delta") {
              outcome.receivedText = true;
              setStreamingByStep((prev) => {
                const current = prev[stepId];
                if (!current) return prev;
                return {
                  ...prev,
                  [stepId]: {
                    ...current,
                    assistantText: current.assistantText + event.text,
                  },
                };
              });
            } else if (event.type === "error") {
              outcome.error = event.message;
            }
          },
        });
      } catch (streamError) {
        const cancelled =
          controller.signal.aborted ||
          (streamError instanceof ApiError && streamError.code === "CANCELLED");

        if (!cancelled) {
          if (outcome.receivedEvent) {
            outcome.error = toMessage(streamError);
          } else {
            failure = toMessage(streamError);
          }
        }
      } finally {
        controllers.current.delete(stepId);
      }

      if (failure) {
        setFailedSendByStep((prev) => ({
          ...prev,
          [stepId]: {
            userMessage: text,
            message: failure as string,
            startedAt,
            images: images?.map((image) => ({
              assetId: "",
              mimeType: image.mediaType,
              url: `data:${image.mediaType};base64,${image.data}`,
            })),
          },
        }));
        setStreamingByStep((prev) => {
          if (!(stepId in prev)) return prev;
          const next = { ...prev };
          delete next[stepId];
          return next;
        });
        return;
      }

      // 取消时服务端 close 落库与客户端 reject 存在时序差，稍等再刷新
      if (controller.signal.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 180));
      }

      try {
        await load();
      } catch {
        // 刷新失败时保留现有数据，不覆盖错误提示
      }

      setStreamingByStep((prev) => {
        if (!(stepId in prev)) return prev;
        const next = { ...prev };
        delete next[stepId];
        return next;
      });

      if (outcome.error) setError(outcome.error);
    },
    [load, toMessage],
  );

  const sendMessage = useCallback(
    (rawText: string, images?: StreamImage[]) => {
      const text = rawText.trim();
      const stepId = useUiStore.getState().activeStepId;
      if ((!text && (!images || images.length === 0)) || !stepId || streamingByStep[stepId]) {
        return;
      }
      void runStream(stepId, text, images);
    },
    [runStream, streamingByStep],
  );

  const stopGeneration = useCallback((stepId?: string) => {
    const target = stepId ?? useUiStore.getState().activeStepId;
    if (!target) return;

    const controller = controllers.current.get(target);
    if (!controller) return;

    setStreamingByStep((prev) => {
      const current = prev[target];
      if (!current || current.stopping) return prev;
      return { ...prev, [target]: { ...current, stopping: true } };
    });
    controller.abort();
  }, []);

  const retryFailedSend = useCallback(
    (stepId?: string) => {
      const target = stepId ?? useUiStore.getState().activeStepId;
      if (!target) return;
      const failed = failedSendByStep[target];
      if (!failed) return;
      void runStream(
        target,
        failed.userMessage,
        failed.images
          ?.filter((image) => image.url.startsWith("data:"))
          .map((image) => ({
            mediaType: image.mimeType,
            data: image.url.slice(image.url.indexOf(",") + 1),
          })),
      );
    },
    [failedSendByStep, runStream],
  );

  const generateSolution = useCallback(async (extraRequirement?: string) => {
    const questionId = useUiStore.getState().selectedQuestionId;
    if (!questionId || generatingSolutionFor) return;

    setGeneratingSolutionFor(questionId);
    setSolutionError(null);

    try {
      await api.generateSolution(questionId, extraRequirement);
      // 旧步骤已被覆盖，清空指向已删除步骤的讨论选择
      useUiStore.getState().selectQuestion(questionId);
      await load();
    } catch (generationError) {
      setSolutionError({
        message: toMessage(generationError),
        code: generationError instanceof ApiError ? generationError.code : undefined,
      });
    } finally {
      setGeneratingSolutionFor(null);
    }
  }, [generatingSolutionFor, load, toMessage]);

  const generateExplanation = useCallback(async (extraRequirement?: string) => {
    const questionId = useUiStore.getState().selectedQuestionId;
    if (!questionId || generatingExplanation) return;

    setGeneratingExplanation(true);
    setExplanationError(null);

    try {
      await api.generateExplanation(questionId, extraRequirement);
      await load();
    } catch (generationError) {
      setExplanationError(toMessage(generationError));
    } finally {
      setGeneratingExplanation(false);
    }
  }, [generatingExplanation, load, toMessage]);

  // 手动编辑步骤：保存成功后刷新数据（后端在同一事务内写 manual 版本快照）
  const updateStep = useCallback(
    async (stepId: string, patch: { title?: string; content?: string }): Promise<string | null> => {
      try {
        await api.updateStep(stepId, patch);
        await load();
        return null;
      } catch (updateError) {
        return toMessage(updateError);
      }
    },
    [load, toMessage],
  );

  const loadRevisions = useCallback(async () => {
    const questionId = useUiStore.getState().selectedQuestionId;
    if (!questionId) {
      setRevisions([]);
      return;
    }
    setRevisionsLoading(true);
    try {
      setRevisions(await api.getRevisions(questionId));
    } catch (loadError) {
      setError(toMessage(loadError));
    } finally {
      setRevisionsLoading(false);
    }
  }, [toMessage]);

  const restoreRevision = useCallback(
    async (revisionId: string): Promise<string | null> => {
      const questionId = useUiStore.getState().selectedQuestionId;
      if (!questionId || restoringRevision) return null;
      setRestoringRevision(true);
      try {
        await api.restoreRevision(questionId, revisionId);
        useUiStore.getState().selectQuestion(questionId);
        await load();
        await loadRevisions();
        return null;
      } catch (restoreError) {
        return toMessage(restoreError);
      } finally {
        setRestoringRevision(false);
      }
    },
    [load, loadRevisions, restoringRevision, toMessage],
  );

  const createGroup = useCallback(
    (title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      void run(async () => {
        const group = await api.createGroup(trimmed);
        await load();
        // 选中题组后试卷分组自动回落到首个（新建题组默认带一个「默认试卷」）
        useUiStore.getState().selectGroup(group.id);
      });
    },
    [load, run],
  );

  const createPaperGroup = useCallback(
    (groupId: string, title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      void run(async () => {
        const paper = await api.createPaperGroup(groupId, trimmed);
        await load();
        useUiStore.getState().selectPaperGroup(groupId, paper.id);
      });
    },
    [load, run],
  );

  const renameGroup = useCallback(
    (groupId: string, title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      void run(async () => {
        await api.renameGroup(groupId, trimmed);
        await load();
      });
    },
    [load, run],
  );

  const renamePaperGroup = useCallback(
    (paperGroupId: string, title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      void run(async () => {
        await api.renamePaperGroup(paperGroupId, trimmed);
        await load();
      });
    },
    [load, run],
  );

  const deletePaperGroup = useCallback(
    (paperGroupId: string) => {
      void run(async () => {
        await api.deletePaperGroup(paperGroupId);
        const ui = useUiStore.getState();
        if (ui.selectedPaperGroupId === paperGroupId) ui.selectGroup(ui.selectedGroupId ?? "");
        await load();
      });
    },
    [load, run],
  );

  /** 在指定题组 + 试卷分组下以文字新建题目；成功后关闭添加弹窗并选中新题目 */
  const createQuestionIn = useCallback(
    (groupId: string, content: string) => {
      const trimmed = content.trim();
      if (!trimmed || !groupId) return;
      void run(async () => {
        const created = await api.createQuestion(groupId, trimmed, imageImportPaperGroupId ?? undefined);
        setImageImportGroupId(null);
        setImageImportPaperGroupId(null);
        if (created.paperGroupId) {
          useUiStore.getState().selectPaperGroup(groupId, created.paperGroupId);
        } else {
          useUiStore.getState().selectGroup(groupId);
        }
        useUiStore.getState().selectQuestion(created.id);
        await load();
      });
    },
    [imageImportPaperGroupId, load, run],
  );

  const openImageImport = useCallback(
    (groupId: string, paperGroupId: string | null = null, tab: "text" | "image" = "text") => {
      setImageImportGroupId(groupId);
      setImageImportPaperGroupId(paperGroupId);
      setImageImportTab(tab);
      setImageImportQuestions([]);
      setImageImportError(null);
    },
    [],
  );

  const closeImageImport = useCallback(() => {
    setImageImportGroupId(null);
    setImageImportPaperGroupId(null);
    setImageImportTab("text");
    setImageImportQuestions([]);
    setImageImportError(null);
  }, []);

  const analyzeImages = useCallback(
    async (images: Array<{ mediaType: string; data: string }>, extraPrompt?: string) => {
      const groupId = imageImportGroupId;
      if (!groupId) return t("workspace.selectGroupFirst");
      setImageImportAnalyzing(true);
      setImageImportError(null);
      try {
        const result = await api.importQuestionsFromImages(groupId, images, extraPrompt);
        setImageImportQuestions(result.questions);
        return null;
      } catch (analyzeError) {
        const message = toMessage(analyzeError);
        setImageImportError(message);
        return message;
      } finally {
        setImageImportAnalyzing(false);
      }
    },
    [imageImportGroupId, t, toMessage],
  );

  const createQuestionsFromImages = useCallback(
    async (
      contents: string[],
      images: Array<{ mediaType: string; data: string }> = [],
    ) => {
      const groupId = imageImportGroupId;
      if (!groupId) return t("workspace.selectGroupFirst");
      const cleaned = contents.map((content) => content.trim()).filter(Boolean);
      if (cleaned.length === 0) return t("workspace.keepAtLeastOneQuestion");

      setImageImportCreating(true);
      setImageImportError(null);
      try {
        const created: Question[] = [];
        for (const content of cleaned) {
          const question = await api.createQuestion(
            groupId,
            content,
            imageImportPaperGroupId ?? undefined,
          );
          // 截图随题目入库，后续解题与讨论可按题目图片策略进入 AI 上下文
          if (images.length > 0) {
            await api.uploadQuestionAssets(question.id, images);
          }
          created.push(question);
        }
        // 先刷新数据再切换选择，避免选择恢复逻辑把焦点落回第一题
        await load();
        const ui = useUiStore.getState();
        if (created[0].paperGroupId) {
          ui.selectPaperGroup(groupId, created[0].paperGroupId);
        } else {
          ui.selectGroup(groupId);
        }
        ui.selectQuestion(created[0].id);
        setImageImportGroupId(null);
        setImageImportPaperGroupId(null);
        setImageImportQuestions([]);
        return null;
      } catch (createError) {
        const message = toMessage(createError);
        setImageImportError(message);
        return message;
      } finally {
        setImageImportCreating(false);
      }
    },
    [imageImportGroupId, imageImportPaperGroupId, load, t, toMessage],
  );

  const openMobileLink = useCallback(async () => {
    setMobileLinkOpen(true);
    setMobileLinkLoading(true);
    setMobileLinkError(null);
    try {
      const link = await api.getMobileLink(crypto.randomUUID());
      setMobileLinkUrls(link.urls);
    } catch (linkError) {
      setMobileLinkUrls([]);
      setMobileLinkError(toMessage(linkError));
    } finally {
      setMobileLinkLoading(false);
    }
  }, [toMessage]);

  const closeMobileLink = useCallback(() => {
    setMobileLinkOpen(false);
    setMobileLinkUrls([]);
    setMobileLinkError(null);
    // 关闭弹窗时补一次静默刷新，兜住「先关弹窗、再在手机上提交」的情况
    void load(false, true).catch(() => undefined);
  }, [load]);

  const deleteQuestion = useCallback(
    (id: string) => {
      void run(async () => {
        await api.deleteQuestion(id);
        const ui = useUiStore.getState();
        if (ui.selectedQuestionId === id) {
          if (ui.selectedGroupId) ui.selectGroup(ui.selectedGroupId);
          else ui.resetSelection();
        }
        await load();
      });
    },
    [load, run],
  );

  const uploadQuestionAssets = useCallback(
    async (
      questionId: string,
      images: Array<{ mediaType: string; data: string }>,
    ): Promise<string | null> => {
      try {
        await api.uploadQuestionAssets(questionId, images);
        await load();
        return null;
      } catch (uploadError) {
        return toMessage(uploadError);
      }
    },
    [load, toMessage],
  );

  const deleteQuestionAsset = useCallback(
    (questionId: string, assetId: string) => {
      void run(async () => {
        await api.deleteQuestionAsset(questionId, assetId);
        await load();
      });
    },
    [load, run],
  );

  const deleteGroup = useCallback(
    (id: string) => {
      void run(async () => {
        await api.deleteGroup(id);
        const ui = useUiStore.getState();
        if (ui.selectedGroupId === id) ui.resetSelection();
        await load();
      });
    },
    [load, run],
  );

  const exportBackup = useCallback((includeImages: boolean) => {
    void run(async () => {
      const payload = await api.exportBackup({ includeImages });
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const suffix = includeImages ? "-with-images" : "";
      link.download = `motive-studio-backup-${new Date().toISOString().slice(0, 10)}${suffix}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    });
  }, [run]);

  const saveFile = useCallback((blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, []);

  const exportQuestionMarkdown = useCallback(
    (questionId: string) => {
      void run(async () => {
        const file = await api.exportQuestionMarkdown(questionId);
        saveFile(file.blob, file.filename);
      });
    },
    [run, saveFile],
  );

  const exportGroupMarkdown = useCallback(
    (groupId: string) => {
      void run(async () => {
        const file = await api.exportGroupMarkdown(groupId);
        saveFile(file.blob, file.filename);
      });
    },
    [run, saveFile],
  );

  const importBackup = useCallback(
    (file: File) => {
      void (async () => {
        let payload: unknown;
        try {
          payload = JSON.parse(await file.text());
        } catch {
          setError(t("workspace.backupInvalidJson"));
          return;
        }

        try {
          await api.importBackup(payload);
          useUiStore.getState().resetSelection();
          await load();
          setError(null);
        } catch (importError) {
          setError(toMessage(importError));
        }
      })();
    },
    [load, t, toMessage],
  );

  return {
    loading,
    groups,
    paperGroups,
    paperGroupsInSelectedGroup,
    selectedPaperGroup,
    questionsInGroup,
    selectedGroup,
    question,
    steps,
    explanations,
    activeStep,
    activeSubId: activeSub?.id,
    messages,
    thinking,
    streaming,
    sendFailed,
    stopGeneration,
    retryFailedSend,
    tagCountByStep,
    error,
    fatalError,
    retry,
    dismissError,
    createGroup,
    createPaperGroup,
    renameGroup,
    renamePaperGroup,
    deletePaperGroup,
    imageImportGroupId,
    imageImportPaperGroupId,
    imageImportAnalyzing,
    imageImportCreating,
    imageImportError,
    imageImportQuestions,
    imageImportTab,
    openImageImport,
    closeImageImport,
    analyzeImages,
    createQuestionsFromImages,
    mobileLinkOpen,
    mobileLinkLoading,
    mobileLinkError,
    mobileLinkUrls,
    openMobileLink,
    closeMobileLink,
    deleteGroup,
    deleteQuestion,
    createQuestionIn,
    providerSupportsVision,
    uploadQuestionAssets,
    deleteQuestionAsset,
    sendMessage,
    generatingSolution: generatingSolutionFor !== null,
    solutionError,
    generateSolution,
    generatingExplanation,
    explanationError,
    generateExplanation,
    turns: data.turns,
    updateStep,
    revisions,
    revisionsLoading,
    loadRevisions,
    restoreRevision,
    restoringRevision,
    exportBackup,
    exportQuestionMarkdown,
    exportGroupMarkdown,
    importBackup,
  };
}

export type WorkspaceApi = ReturnType<typeof useWorkspace>;
