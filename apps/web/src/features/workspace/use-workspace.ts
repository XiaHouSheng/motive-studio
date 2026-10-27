import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ArchiveProposal,
  Question,
  SolutionRevision,
  SolutionStep,
  TurnArchiveStatus,
  TurnGenerationStatus,
  TurnTagStatus,
  WorkspaceData,
} from "@motive/shared";
import { useUiStore } from "@/stores/ui";
import { ApiError, api } from "@/lib/api";

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
  archiveStatus?: TurnArchiveStatus;
  generationStatus?: TurnGenerationStatus;
  tags: ChatTag[];
  streaming?: boolean;
  failed?: boolean;
}

interface StreamingState {
  userMessage: string;
  assistantText: string;
  startedAt: number;
  stopping: boolean;
}

interface FailedSend {
  userMessage: string;
  message: string;
  startedAt: number;
}

const EMPTY_WORKSPACE: WorkspaceData = {
  groups: [],
  questions: [],
  steps: [],
  subs: [],
  turns: [],
  tags: [],
  explanations: [],
};

function toMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "操作失败，请重试";
}

export function useWorkspace() {
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
  const [pendingProposal, setPendingProposal] = useState<ArchiveProposal | null>(null);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [archiveGenerating, setArchiveGenerating] = useState(false);
  const [archiveApplying, setArchiveApplying] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<SolutionRevision[]>([]);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const [restoringRevision, setRestoringRevision] = useState(false);
  const [imageImportGroupId, setImageImportGroupId] = useState<string | null>(null);
  const [imageImportAnalyzing, setImageImportAnalyzing] = useState(false);
  const [imageImportCreating, setImageImportCreating] = useState(false);
  const [imageImportError, setImageImportError] = useState<string | null>(null);
  const [imageImportQuestions, setImageImportQuestions] = useState<string[]>([]);
  const [mobileLinkOpen, setMobileLinkOpen] = useState(false);
  const [mobileLinkLoading, setMobileLinkLoading] = useState(false);
  const [mobileLinkError, setMobileLinkError] = useState<string | null>(null);
  const [mobileLinkUrls, setMobileLinkUrls] = useState<string[]>([]);
  const controllers = useRef<Map<string, AbortController>>(new Map());
  const lastLoadAt = useRef(0);

  const selectedGroupId = useUiStore((state) => state.selectedGroupId);
  const selectedQuestionId = useUiStore((state) => state.selectedQuestionId);
  const activeStepId = useUiStore((state) => state.activeStepId);
  const initializeSelection = useUiStore((state) => state.initializeSelection);
  const resetSelection = useUiStore((state) => state.resetSelection);

  const load = useCallback(async (initial = false) => {
    if (initial) {
      setLoading(true);
      setFatalError(null);
    }
    try {
      const next = await api.bootstrap();
      setData(next);
      lastLoadAt.current = Date.now();
      setFatalError(null);
    } catch (loadError) {
      const message = toMessage(loadError);
      if (initial) setFatalError(message);
      throw loadError;
    } finally {
      if (initial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(true).catch(() => undefined);
  }, [load]);

  // 手机导入弹窗打开期间，窗口重新聚焦或切回标签页时静默刷新，让手机提交的结果及时出现
  useEffect(() => {
    if (!mobileLinkOpen) return;
    const maybeRefresh = () => {
      if (Date.now() - lastLoadAt.current > 3000) {
        lastLoadAt.current = Date.now();
        void load().catch(() => undefined);
      }
    };
    const handleFocus = () => maybeRefresh();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") maybeRefresh();
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [mobileLinkOpen, load]);

  // 切换题目时同步该题最新的待确认归档提案
  useEffect(() => {
    setPendingProposal(null);
    setArchiveDialogOpen(false);
    setArchiveError(null);
    if (!selectedQuestionId) return;

    let cancelled = false;
    void api
      .listArchiveProposals(selectedQuestionId)
      .then((list) => {
        if (cancelled) return;
        setPendingProposal(
          list.find((proposal) => proposal.status === "pending") ?? null,
        );
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [selectedQuestionId]);

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
  }, []);

  const retry = useCallback(() => {
    void load(true).catch(() => undefined);
  }, [load]);

  const dismissError = useCallback(() => setError(null), []);

  const groups = data.groups;

  const questionsInGroup = useMemo(() => {
    if (!selectedGroupId) return [];
    const group = data.groups.find((item) => item.id === selectedGroupId);
    if (!group) return [];
    return group.questionIds
      .map((id) => data.questions.find((question) => question.id === id))
      .filter((question): question is Question => Boolean(question));
  }, [data.groups, data.questions, selectedGroupId]);

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
        });
        pairs.push({
          id: `${turn.id}-assistant`,
          role: "assistant",
          content: turn.assistantMessage,
          createdAt: turn.createdAt,
          tagStatus: turn.tagStatus,
          archiveStatus: turn.archiveStatus,
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
      });
      if (streaming.assistantText) {
        pairs.push({
          id: `stream-${activeStep.id}-assistant`,
          role: "assistant",
          content: streaming.assistantText,
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
    async (stepId: string, text: string) => {
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
        },
      }));

      const outcome: { error?: string; receivedEvent: boolean; receivedText: boolean } = {
        receivedEvent: false,
        receivedText: false,
      };
      let failure: string | null = null;

      try {
        await api.streamMessage(stepId, text, {
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
          [stepId]: { userMessage: text, message: failure as string, startedAt },
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
    [load],
  );

  const sendMessage = useCallback(
    (rawText: string) => {
      const text = rawText.trim();
      const stepId = useUiStore.getState().activeStepId;
      if (!text || !stepId || streamingByStep[stepId]) return;
      void runStream(stepId, text);
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
      void runStream(target, failed.userMessage);
    },
    [failedSendByStep, runStream],
  );

  const generateSolution = useCallback(async () => {
    const questionId = useUiStore.getState().selectedQuestionId;
    if (!questionId || generatingSolutionFor) return;

    setGeneratingSolutionFor(questionId);
    setSolutionError(null);

    try {
      await api.generateSolution(questionId);
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
  }, [generatingSolutionFor, load]);

  const generateArchive = useCallback(
    async (subConversationId: string) => {
      if (archiveGenerating) return;
      setArchiveGenerating(true);
      setArchiveError(null);
      try {
        const proposal = await api.generateArchiveProposal(subConversationId);
        setPendingProposal(proposal);
        setArchiveDialogOpen(true);
      } catch (generationError) {
        setArchiveError(toMessage(generationError));
      } finally {
        setArchiveGenerating(false);
      }
    },
    [archiveGenerating],
  );

  const openArchiveDialog = useCallback(() => {
    if (!pendingProposal) return;
    setArchiveError(null);
    setArchiveDialogOpen(true);
  }, [pendingProposal]);

  const closeArchiveDialog = useCallback(() => {
    if (archiveApplying) return;
    setArchiveDialogOpen(false);
  }, [archiveApplying]);

  const applyArchive = useCallback(async (): Promise<string | null> => {
    if (!pendingProposal || archiveApplying) return null;
    setArchiveApplying(true);
    try {
      await api.applyArchiveProposal(pendingProposal.id);
      setPendingProposal(null);
      setArchiveDialogOpen(false);
      await load();
      return null;
    } catch (applyError) {
      return toMessage(applyError);
    } finally {
      setArchiveApplying(false);
    }
  }, [archiveApplying, load, pendingProposal]);

  const rejectArchive = useCallback(async (): Promise<string | null> => {
    if (!pendingProposal) return null;
    try {
      await api.rejectArchiveProposal(pendingProposal.id);
      setPendingProposal(null);
      setArchiveDialogOpen(false);
      return null;
    } catch (rejectError) {
      return toMessage(rejectError);
    }
  }, [pendingProposal]);

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
  }, []);

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
    [load, loadRevisions, restoringRevision],
  );

  const createGroup = useCallback(
    (title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      void run(async () => {
        const group = await api.createGroup(trimmed);
        useUiStore.getState().selectGroup(group.id);
        await load();
      });
    },
    [load, run],
  );

  const createQuestion = useCallback(
    (content: string) => {
      const trimmed = content.trim();
      const groupId = useUiStore.getState().selectedGroupId;
      if (!trimmed || !groupId) return;
      void run(async () => {
        const created = await api.createQuestion(groupId, trimmed);
        useUiStore.getState().selectQuestion(created.id);
        await load();
      });
    },
    [load, run],
  );

  const openImageImport = useCallback((groupId: string) => {
    setImageImportGroupId(groupId);
    setImageImportQuestions([]);
    setImageImportError(null);
  }, []);

  const closeImageImport = useCallback(() => {
    setImageImportGroupId(null);
    setImageImportQuestions([]);
    setImageImportError(null);
  }, []);

  const analyzeImages = useCallback(
    async (images: Array<{ mediaType: string; data: string }>) => {
      const groupId = imageImportGroupId;
      if (!groupId) return "请先选择题组";
      setImageImportAnalyzing(true);
      setImageImportError(null);
      try {
        const result = await api.importQuestionsFromImages(groupId, images);
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
    [imageImportGroupId],
  );

  const createQuestionsFromImages = useCallback(
    async (contents: string[]) => {
      const groupId = imageImportGroupId;
      if (!groupId) return "请先选择题组";
      const cleaned = contents.map((content) => content.trim()).filter(Boolean);
      if (cleaned.length === 0) return "请至少保留一道题目";

      setImageImportCreating(true);
      setImageImportError(null);
      try {
        const created: Question[] = [];
        for (const content of cleaned) {
          created.push(await api.createQuestion(groupId, content));
        }
        // 先刷新数据再切换选择，避免选择恢复逻辑把焦点落回第一题
        await load();
        const ui = useUiStore.getState();
        ui.selectGroup(groupId);
        ui.selectQuestion(created[0].id);
        setImageImportGroupId(null);
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
    [imageImportGroupId, load],
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
  }, []);

  const closeMobileLink = useCallback(() => {
    setMobileLinkOpen(false);
    setMobileLinkUrls([]);
    setMobileLinkError(null);
  }, []);

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

  const exportBackup = useCallback(() => {
    void run(async () => {
      const payload = await api.exportBackup();
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `motive-studio-backup-${new Date().toISOString().slice(0, 10)}.json`;
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
          setError("备份文件不是有效的 JSON");
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
    [load],
  );

  return {
    loading,
    groups,
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
    createQuestion,
    imageImportGroupId,
    imageImportAnalyzing,
    imageImportCreating,
    imageImportError,
    imageImportQuestions,
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
    sendMessage,
    generatingSolution: generatingSolutionFor !== null,
    solutionError,
    generateSolution,
    turns: data.turns,
    pendingProposal,
    archiveDialogOpen,
    archiveGenerating,
    archiveApplying,
    archiveError,
    openArchiveDialog,
    closeArchiveDialog,
    generateArchive,
    applyArchive,
    rejectArchive,
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
