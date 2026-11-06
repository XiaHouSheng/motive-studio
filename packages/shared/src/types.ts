export type ID = string;

export interface QuestionGroup {
  id: ID;
  title: string;
  questionIds: ID[];
  createdAt: number;
  updatedAt: number;
}

/** 题目图片策略：auto 按模型能力决定，always 强制附带，never 不附带 */
export type ImagePolicy = "auto" | "always" | "never";

export interface QuestionAsset {
  id: ID;
  mimeType: string;
  fileSize: number;
  createdAt: number;
  /** 浏览器可用的读取地址：/api/assets/<id> */
  url: string;
}

export interface Question {
  id: ID;
  groupId: ID;
  content: string;
  solutionStepIds: ID[];
  imagePolicy: ImagePolicy;
  assets: QuestionAsset[];
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

export interface SubConversation {
  id: ID;
  entryStepId: ID;
  turnIds: ID[];
  createdAt: number;
  updatedAt: number;
}

export type TurnTagStatus = "pending" | "tagged" | "failed";
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
