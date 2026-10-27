export type ID = string;

export interface QuestionGroup {
  id: ID;
  title: string;
  questionIds: ID[];
  createdAt: number;
  updatedAt: number;
}

export interface Question {
  id: ID;
  groupId: ID;
  content: string;
  solutionStepIds: ID[];
  createdAt: number;
  updatedAt: number;
}

export interface SolutionStep {
  id: ID;
  questionId: ID;
  order: number;
  title: string;
  content: string;
  updatedAt: number;
}

export interface SolutionStepDraft {
  title: string;
  content: string;
}

export type SolutionRevisionCreator = "ai" | "manual" | "archive";

export interface SolutionRevision {
  id: ID;
  questionId: ID;
  revisionNumber: number;
  steps: SolutionStepDraft[];
  createdAt: number;
  createdBy: SolutionRevisionCreator;
}

export interface SolutionGenerationResult {
  steps: SolutionStep[];
  revision: SolutionRevision;
}

export type ArchiveAction =
  | "add_explanation"
  | "revise_content"
  | "no_change"
  | "needs_review";

export interface ArchiveChange {
  stepId: ID;
  action: ArchiveAction;
  proposedContent?: string;
  rationale: string;
  sourceTurnIds: ID[];
}

export interface ArchiveProposalDraft {
  summary: string;
  changes: ArchiveChange[];
}

export type ArchiveProposalStatus = "pending" | "applied" | "rejected";

export interface ArchiveProposal {
  id: ID;
  subConversationId: ID;
  questionId: ID;
  status: ArchiveProposalStatus;
  summary: string;
  changes: ArchiveChange[];
  sourceTurnIds: ID[];
  createdAt: number;
  appliedAt?: number;
}

export interface ArchiveApplyResult {
  steps: SolutionStep[];
  revision: SolutionRevision | null;
  proposal: ArchiveProposal;
}

export interface SubConversation {
  id: ID;
  entryStepId: ID;
  turnIds: ID[];
  createdAt: number;
  updatedAt: number;
}

export type TurnTagStatus = "pending" | "tagged" | "failed";
export type TurnArchiveStatus = "unarchived" | "archived";
export type TurnGenerationStatus = "completed" | "interrupted";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ConversationTurn {
  id: ID;
  subConversationId: ID;
  userMessage: string;
  assistantMessage: string;
  createdAt: number;
  archiveStatus: TurnArchiveStatus;
  tagStatus: TurnTagStatus;
  generationStatus?: TurnGenerationStatus;
  tagUsage?: TokenUsage;
  chatUsage?: TokenUsage;
}

export interface TurnStepTag {
  id: ID;
  turnId: ID;
  stepId: ID;
  relevance?: string;
  createdAt: number;
}

export type ExplanationStatus = "pending" | "processing" | "completed" | "failed";

export interface PromptLogEntry {
  system: string;
  user: string;
  estimatedTokens: number;
  usage?: TokenUsage;
}

export interface SolutionExplanation {
  id: ID;
  questionId: ID;
  content: string;
  summary: string;
  status: ExplanationStatus;
  turnIds: ID[];
  errorMessage?: string;
  createdAt: number;
  usage?: TokenUsage;
  promptLog?: PromptLogEntry;
}
