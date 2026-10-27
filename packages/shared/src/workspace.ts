import type {
  ConversationTurn,
  Question,
  QuestionGroup,
  SolutionExplanation,
  SolutionStep,
  SubConversation,
  TurnStepTag,
} from "./types";

export interface WorkspaceData {
  groups: QuestionGroup[];
  questions: Question[];
  steps: SolutionStep[];
  subs: SubConversation[];
  turns: ConversationTurn[];
  tags: TurnStepTag[];
  explanations: SolutionExplanation[];
}

export interface BackupPayload {
  version: 1;
  exportedAt: number;
  data: WorkspaceData;
}

export interface ConversationView {
  subConversation: SubConversation | null;
  turns: ConversationTurn[];
  tags: TurnStepTag[];
}

export interface ApiErrorBody {
  code: string;
  message: string;
}
