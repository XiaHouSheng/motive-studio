import type {
  ArchiveAction,
  ArchiveChange,
  ArchiveProposalDraft,
  ChatMessage,
} from "@motive/shared";
import type { ArchiveContextData } from "../../repositories/workspace-repository.js";
import { buildArchiveMessages } from "./archive-context-builder.js";
import { AIError } from "./errors.js";
import { stripCodeFence } from "./solution-generator.js";
import type { AIProvider } from "./types.js";

export const ARCHIVE_TEMPERATURE = 0.2;

const MAX_ATTEMPTS = 2;
const MAX_CHANGES = 20;
const MAX_SUMMARY_LENGTH = 600;
const MAX_RATIONALE_LENGTH = 500;
const MAX_CONTENT_LENGTH = 40_000;

const ACTIONS: ArchiveAction[] = [
  "add_explanation",
  "revise_content",
  "no_change",
  "needs_review",
];

function parseChange(item: unknown, index: number): ArchiveChange {
  const label = `第 ${index + 1} 项变更`;
  if (typeof item !== "object" || item === null) {
    throw new AIError("INVALID_RESPONSE", `${label}格式不正确`);
  }

  const record = item as {
    stepId?: unknown;
    action?: unknown;
    proposedContent?: unknown;
    rationale?: unknown;
    sourceTurnIds?: unknown;
  };

  const stepId = typeof record.stepId === "string" ? record.stepId.trim() : "";
  if (!stepId) throw new AIError("INVALID_RESPONSE", `${label}缺少步骤 ID`);

  const action = record.action;
  if (typeof action !== "string" || !ACTIONS.includes(action as ArchiveAction)) {
    throw new AIError("INVALID_RESPONSE", `${label}的 action 不合法`);
  }

  const rationale =
    typeof record.rationale === "string" ? record.rationale.trim() : "";
  if (!rationale) throw new AIError("INVALID_RESPONSE", `${label}缺少修改依据`);

  const rawSource = record.sourceTurnIds;
  if (
    !Array.isArray(rawSource) ||
    rawSource.some((value) => typeof value !== "string")
  ) {
    throw new AIError("INVALID_RESPONSE", `${label}的来源轮次格式不正确`);
  }
  const sourceTurnIds = (rawSource as string[])
    .map((value) => value.trim())
    .filter(Boolean);

  const proposedContent =
    typeof record.proposedContent === "string"
      ? record.proposedContent.trim()
      : "";

  const common = {
    stepId,
    rationale: rationale.slice(0, MAX_RATIONALE_LENGTH),
    sourceTurnIds,
  };

  if (action === "add_explanation" || action === "revise_content") {
    if (!proposedContent) {
      throw new AIError("INVALID_RESPONSE", `${label}缺少要写入的内容`);
    }
    if (proposedContent.length > MAX_CONTENT_LENGTH) {
      throw new AIError("INVALID_RESPONSE", `${label}内容过长`);
    }
    if (sourceTurnIds.length === 0) {
      throw new AIError("INVALID_RESPONSE", `${label}缺少来源讨论轮次`);
    }
    return {
      ...common,
      action,
      proposedContent,
    };
  }

  if (proposedContent) {
    throw new AIError(
      "INVALID_RESPONSE",
      `${label}为 ${action} 时不应包含要写入的内容`,
    );
  }

  return { ...common, action: action as ArchiveAction };
}

export function parseArchiveProposal(raw: string): ArchiveProposalDraft {
  const text = stripCodeFence(raw);
  if (!text) throw new AIError("INVALID_RESPONSE", "模型未返回归档提案");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AIError("INVALID_RESPONSE", "模型返回的归档提案不是有效 JSON");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new AIError("INVALID_RESPONSE", "模型返回的归档提案格式不正确");
  }

  const record = parsed as { summary?: unknown; changes?: unknown };
  const summary = typeof record.summary === "string" ? record.summary.trim() : "";
  if (!summary) throw new AIError("INVALID_RESPONSE", "归档提案缺少概述");

  const rawChanges = record.changes;
  if (!Array.isArray(rawChanges) || rawChanges.length > MAX_CHANGES) {
    throw new AIError(
      "INVALID_RESPONSE",
      `归档提案的变更项不能超过 ${MAX_CHANGES} 项`,
    );
  }

  return {
    summary: summary.slice(0, MAX_SUMMARY_LENGTH),
    changes: rawChanges.map((item, index) => parseChange(item, index)),
  };
}

async function collectResponse(
  provider: AIProvider,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<string> {
  let text = "";
  for await (const event of provider.streamChat(
    { messages, temperature: ARCHIVE_TEMPERATURE },
    signal,
  )) {
    if (event.type === "text-delta") {
      text += event.text;
      continue;
    }
    if (event.type === "error") {
      throw new AIError(event.code, event.message);
    }
  }
  return text;
}

export async function generateArchiveProposal(
  provider: AIProvider,
  context: ArchiveContextData,
  signal?: AbortSignal,
): Promise<ArchiveProposalDraft> {
  const messages = buildArchiveMessages(context);
  let lastError: AIError | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const raw = await collectResponse(provider, messages, signal);
    try {
      return parseArchiveProposal(raw);
    } catch (error) {
      if (!(error instanceof AIError)) throw error;
      lastError = error;
    }
  }

  throw lastError ?? new AIError("INVALID_RESPONSE", "模型未返回有效归档提案");
}
