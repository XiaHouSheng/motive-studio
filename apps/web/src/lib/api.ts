import {
  createSseParser,
  type ArchiveApplyResult,
  type ArchiveProposal,
  type BackupPayload,
  type ChatStreamEvent,
  type ConversationTurn,
  type ConversationView,
  type ProviderSettingsUpdate,
  type ProviderSettingsView,
  type ProviderTestResult,
  type Question,
  type QuestionGroup,
  type SolutionExplanation,
  type SolutionGenerationResult,
  type SolutionRevision,
  type SolutionStep,
  type SubConversation,
  type TurnStepTag,
  type WorkspaceData,
} from "@motive/shared";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function toResponseError(response: Response): Promise<ApiError> {
  let code = "REQUEST_FAILED";
  let message = `请求失败（${response.status}）`;
  try {
    const body = (await response.json()) as { code?: string; message?: string };
    if (body.code) code = body.code;
    if (body.message) message = body.message;
  } catch {
    // 非 JSON 错误响应，沿用默认文案
  }
  return new ApiError(response.status, code, message);
}

interface DownloadedFile {
  blob: Blob;
  filename: string;
}

/** 下载文件并解析服务端 Content-Disposition 中的文件名 */
async function downloadFile(path: string): Promise<DownloadedFile> {
  let response: Response;
  try {
    response = await fetch(path);
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "无法连接本地服务，请确认服务已启动");
  }

  if (!response.ok) {
    throw await toResponseError(response);
  }

  const disposition = response.headers.get("Content-Disposition") ?? "";
  let filename = "motive-export.md";
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const plain = /filename="?([^";]+)"?/i.exec(disposition)?.[1];
  if (encoded) {
    try {
      filename = decodeURIComponent(encoded);
    } catch {
      // 编码异常时保留默认文件名
    }
  } else if (plain) {
    filename = plain;
  }

  return { blob: await response.blob(), filename };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("Content-Type", "application/json");

  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "无法连接本地服务，请确认服务已启动");
  }

  if (!response.ok) {
    throw await toResponseError(response);
  }

  return (await response.json()) as T;
}

export interface AppendedTurn {
  subConversation: SubConversation;
  turn: ConversationTurn;
  tags: TurnStepTag[];
}

export interface StepInput {
  title: string;
  content: string;
  order?: number;
}

export interface StreamMessageOptions {
  signal?: AbortSignal;
  onEvent: (event: ChatStreamEvent) => void;
}

export const api = {
  bootstrap: () => request<WorkspaceData>("/api/bootstrap"),

  createGroup: (title: string) =>
    request<QuestionGroup>("/api/question-groups", {
      method: "POST",
      body: JSON.stringify({ title }),
    }),
  renameGroup: (id: string, title: string) =>
    request<QuestionGroup>(`/api/question-groups/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),
  deleteGroup: (id: string) =>
    request<{ ok: true }>(`/api/question-groups/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  importQuestionsFromImages: (
    groupId: string,
    images: Array<{ mediaType: string; data: string }>,
  ) =>
    request<{ questions: string[] }>(
      `/api/question-groups/${encodeURIComponent(groupId)}/image-import`,
      {
        method: "POST",
        body: JSON.stringify({ images }),
      },
    ),

  createQuestion: (groupId: string, content: string) =>
    request<Question>("/api/questions", {
      method: "POST",
      body: JSON.stringify({ groupId, content }),
    }),
  updateQuestion: (id: string, patch: { content?: string; groupId?: string }) =>
    request<Question>(`/api/questions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteQuestion: (id: string) =>
    request<{ ok: true }>(`/api/questions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  createStep: (questionId: string, input: StepInput) =>
    request<SolutionStep>(`/api/questions/${encodeURIComponent(questionId)}/steps`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  createExplanation: (
    questionId: string,
    input: { content: string; summary: string; turnIds?: string[] },
  ) =>
    request<SolutionExplanation>(
      `/api/questions/${encodeURIComponent(questionId)}/explanations`,
      { method: "POST", body: JSON.stringify(input) },
    ),
  generateSolution: (questionId: string) =>
    request<SolutionGenerationResult>(
      `/api/questions/${encodeURIComponent(questionId)}/solution/generate`,
      { method: "POST" },
    ),
  getRevisions: (questionId: string) =>
    request<SolutionRevision[]>(
      `/api/questions/${encodeURIComponent(questionId)}/revisions`,
    ),
  restoreRevision: (questionId: string, revisionId: string) =>
    request<SolutionGenerationResult>(
      `/api/questions/${encodeURIComponent(questionId)}/revisions/${encodeURIComponent(revisionId)}/restore`,
      { method: "POST" },
    ),

  generateArchiveProposal: (subConversationId: string) =>
    request<ArchiveProposal>(
      `/api/discussions/${encodeURIComponent(subConversationId)}/archive`,
      { method: "POST" },
    ),
  listArchiveProposals: (questionId: string) =>
    request<ArchiveProposal[]>(
      `/api/questions/${encodeURIComponent(questionId)}/archive-proposals`,
    ),
  applyArchiveProposal: (proposalId: string) =>
    request<ArchiveApplyResult>(
      `/api/archive-proposals/${encodeURIComponent(proposalId)}/apply`,
      { method: "POST" },
    ),
  rejectArchiveProposal: (proposalId: string) =>
    request<ArchiveProposal>(
      `/api/archive-proposals/${encodeURIComponent(proposalId)}/reject`,
      { method: "POST" },
    ),

  updateStep: (id: string, patch: { title?: string; content?: string; order?: number }) =>
    request<SolutionStep>(`/api/steps/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteStep: (id: string) =>
    request<{ ok: true }>(`/api/steps/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  getConversation: (stepId: string) =>
    request<ConversationView>(`/api/steps/${encodeURIComponent(stepId)}/conversation`),
  sendMessage: (stepId: string, userMessage: string, assistantMessage: string) =>
    request<AppendedTurn>(`/api/steps/${encodeURIComponent(stepId)}/messages`, {
      method: "POST",
      body: JSON.stringify({ userMessage, assistantMessage }),
    }),

  streamMessage: async (
    stepId: string,
    userMessage: string,
    options: StreamMessageOptions,
  ): Promise<void> => {
    let response: Response;
    try {
      response = await fetch(
        `/api/steps/${encodeURIComponent(stepId)}/messages/stream`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userMessage }),
          signal: options.signal,
        },
      );
    } catch (error) {
      if (options.signal?.aborted) {
        throw new ApiError(0, "CANCELLED", "生成已取消");
      }
      throw new ApiError(0, "NETWORK_ERROR", "无法连接本地服务，请确认服务已启动");
    }

    if (!response.ok) throw await toResponseError(response);
    if (!response.body) {
      throw new ApiError(502, "INVALID_RESPONSE", "服务未返回流式响应");
    }

    const parser = createSseParser();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    const dispatch = (payload: string) => {
      const trimmed = payload.trim();
      if (!trimmed) return;

      let event: ChatStreamEvent;
      try {
        event = JSON.parse(trimmed) as ChatStreamEvent;
      } catch {
        throw new ApiError(502, "INVALID_RESPONSE", "收到无法解析的流式数据");
      }
      options.onEvent(event);
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const payload of parser.push(decoder.decode(value, { stream: true }))) {
          dispatch(payload);
        }
      }
      for (const payload of parser.flush()) dispatch(payload);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (options.signal?.aborted) {
        throw new ApiError(0, "CANCELLED", "生成已取消");
      }
      throw new ApiError(0, "NETWORK_ERROR", "读取回复时连接中断");
    } finally {
      reader.releaseLock();
    }
  },

  getProviderSettings: () =>
    request<ProviderSettingsView>("/api/settings/provider"),
  saveProviderSettings: (input: ProviderSettingsUpdate) =>
    request<ProviderSettingsView>("/api/settings/provider", {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  testProvider: () =>
    request<ProviderTestResult>("/api/settings/provider/test", {
      method: "POST",
    }),

  deleteExplanation: (id: string) =>
    request<{ ok: true }>(`/api/explanations/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),

  exportBackup: () => request<BackupPayload>("/api/backup"),
  exportQuestionMarkdown: (questionId: string) =>
    downloadFile(`/api/exports/questions/${encodeURIComponent(questionId)}`),
  exportGroupMarkdown: (groupId: string) =>
    downloadFile(`/api/exports/groups/${encodeURIComponent(groupId)}`),
  importBackup: (payload: unknown) =>
    request<WorkspaceData>("/api/backup/import", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};
