import type {
  ConversationTurn,
  ID,
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

export interface BackupImage {
  /** 对应 questions[].assets 里的资源 id */
  id: ID;
  mimeType: string;
  /** 原图二进制的 base64 编码 */
  data: string;
}

export interface BackupPayload {
  version: 1;
  exportedAt: number;
  data: WorkspaceData;
  /** 可选：勾选「包含图片」时导出的题目原图（老版本备份无此字段） */
  images?: BackupImage[];
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
