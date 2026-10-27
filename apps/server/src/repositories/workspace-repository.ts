import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  ArchiveApplyResult,
  ArchiveChange,
  ArchiveProposal,
  ArchiveProposalStatus,
  BackupPayload,
  ConversationTurn,
  ConversationView,
  ExplanationStatus,
  ImagePolicy,
  PromptLogEntry,
  Question,
  QuestionAsset,
  QuestionGroup,
  SolutionExplanation,
  SolutionGenerationResult,
  SolutionRevision,
  SolutionRevisionCreator,
  SolutionStep,
  SolutionStepDraft,
  SubConversation,
  TokenUsage,
  TurnArchiveStatus,
  TurnGenerationStatus,
  TurnStepTag,
  TurnTagStatus,
  WorkspaceData,
} from "@motive/shared";
import { insertWorkspaceData } from "../db/insert-workspace.js";
import { withTransaction } from "../db/client.js";
import { HttpError } from "../http-error.js";

export interface ImportedQuestionsResult {
  groupId: string;
  groupTitle: string;
  questions: Question[];
}

export interface GroupSummary {
  id: string;
  title: string;
  questionCount: number;
}

interface GroupRow {
  id: string;
  title: string;
  position: number;
  created_at: number;
  updated_at: number;
}

interface QuestionRow {
  id: string;
  group_id: string;
  content: string;
  position: number;
  image_policy: string;
  created_at: number;
  updated_at: number;
}

interface AssetRow {
  id: string;
  storage_path: string;
  mime_type: string;
  file_size: number;
  sha256: string;
  width: number | null;
  height: number | null;
  status: string;
  created_at: number;
}

interface NewAsset {
  storagePath: string;
  mimeType: string;
  fileSize: number;
  sha256: string;
}

export interface QuestionAssetContext {
  id: string;
  mimeType: string;
  storagePath: string;
}

export interface QuestionContextSource {
  content: string;
  imagePolicy: ImagePolicy;
  assets: QuestionAssetContext[];
}

export interface ContextSnapshotInput {
  questionId: string;
  taskType: "solution_generation";
  imagePolicy: ImagePolicy;
  includedAssetIds: string[];
  selectionReason: string;
  model: string;
}

interface StepRow {
  id: string;
  question_id: string;
  step_order: number;
  title: string;
  content: string;
  updated_at: number;
}

interface SubRow {
  id: string;
  entry_step_id: string;
  created_at: number;
  updated_at: number;
}

interface TurnRow {
  id: string;
  sub_conversation_id: string;
  user_message: string;
  assistant_message: string;
  created_at: number;
  archive_status: string;
  tag_status: string;
  generation_status: string;
  tag_input_tokens: number | null;
  tag_output_tokens: number | null;
  chat_input_tokens: number | null;
  chat_output_tokens: number | null;
}

interface TagRow {
  id: string;
  turn_id: string;
  step_id: string;
  relevance: string | null;
  created_at: number;
}

interface ExplanationRow {
  id: string;
  question_id: string;
  content: string;
  summary: string;
  status: string;
  error_message: string | null;
  created_at: number;
  input_tokens: number | null;
  output_tokens: number | null;
  prompt_system: string | null;
  prompt_user: string | null;
  prompt_estimated_tokens: number | null;
}

interface RevisionRow {
  id: string;
  question_id: string;
  revision_number: number;
  steps: string;
  created_at: number;
  created_by: string;
}

interface ProposalRow {
  id: string;
  sub_conversation_id: string;
  question_id: string;
  status: string;
  summary: string;
  changes: string;
  source_turn_ids: string;
  created_at: number;
  applied_at: number | null;
}

export interface QuestionPatch {
  content?: string;
  groupId?: string;
}

export interface StepInput {
  title: string;
  content: string;
  order?: number;
}

export interface StepPatch {
  title?: string;
  content?: string;
  order?: number;
}

export interface ExplanationInput {
  content: string;
  summary: string;
  status?: ExplanationStatus;
  turnIds?: string[];
  usage?: TokenUsage;
  promptLog?: PromptLogEntry;
  errorMessage?: string;
}

export interface AppendedTurn {
  subConversation: SubConversation;
  turn: ConversationTurn;
  tags: TurnStepTag[];
}

export interface AppendTurnOptions {
  generationStatus?: TurnGenerationStatus;
  chatUsage?: TokenUsage;
}

export interface ChatContextData {
  question: Question;
  steps: SolutionStep[];
  entryStep: SolutionStep;
  history: ConversationTurn[];
}

export interface ArchiveContextData {
  question: Question;
  steps: SolutionStep[];
  entryStep: SolutionStep;
  discussion: SubConversation;
  turns: ConversationTurn[];
  tags: TurnStepTag[];
}

export interface CreateArchiveProposalInput {
  subConversationId: string;
  questionId: string;
  summary: string;
  changes: ArchiveChange[];
  sourceTurnIds: string[];
}

export interface QuestionExportData {
  groupTitle: string;
  question: Question;
  steps: SolutionStep[];
  explanations: SolutionExplanation[];
}

export interface GroupExportData {
  groupTitle: string;
  questions: QuestionExportData[];
}

const REORDER_OFFSET = 1_000_000;
const REORDER_MARK = 2_000_000;

function usageOf(input: number | null, output: number | null): TokenUsage | undefined {
  if (input === null && output === null) return undefined;
  return { inputTokens: input ?? 0, outputTokens: output ?? 0 };
}

function toGroup(row: GroupRow, questionIds: string[]): QuestionGroup {
  return {
    id: row.id,
    title: row.title,
    questionIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toQuestion(
  row: QuestionRow,
  solutionStepIds: string[],
  assets: QuestionAsset[] = [],
): Question {
  return {
    id: row.id,
    groupId: row.group_id,
    content: row.content,
    solutionStepIds,
    imagePolicy: row.image_policy as ImagePolicy,
    assets,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toQuestionAsset(row: {
  id: string;
  mime_type: string;
  file_size: number;
  created_at: number;
}): QuestionAsset {
  return {
    id: row.id,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    createdAt: row.created_at,
    url: `/api/assets/${row.id}`,
  };
}

function toStep(row: StepRow): SolutionStep {
  return {
    id: row.id,
    questionId: row.question_id,
    order: row.step_order,
    title: row.title,
    content: row.content,
    updatedAt: row.updated_at,
  };
}

function toSub(row: SubRow, turnIds: string[]): SubConversation {
  return {
    id: row.id,
    entryStepId: row.entry_step_id,
    turnIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toTurn(row: TurnRow): ConversationTurn {
  return {
    id: row.id,
    subConversationId: row.sub_conversation_id,
    userMessage: row.user_message,
    assistantMessage: row.assistant_message,
    createdAt: row.created_at,
    archiveStatus: row.archive_status as TurnArchiveStatus,
    tagStatus: row.tag_status as TurnTagStatus,
    generationStatus: row.generation_status as TurnGenerationStatus,
    tagUsage: usageOf(row.tag_input_tokens, row.tag_output_tokens),
    chatUsage: usageOf(row.chat_input_tokens, row.chat_output_tokens),
  };
}

function toTag(row: TagRow): TurnStepTag {
  return {
    id: row.id,
    turnId: row.turn_id,
    stepId: row.step_id,
    relevance: row.relevance ?? undefined,
    createdAt: row.created_at,
  };
}

function toExplanation(row: ExplanationRow, turnIds: string[]): SolutionExplanation {
  const promptLog =
    row.prompt_system === null && row.prompt_user === null
      ? undefined
      : {
          system: row.prompt_system ?? "",
          user: row.prompt_user ?? "",
          estimatedTokens: row.prompt_estimated_tokens ?? 0,
        };

  return {
    id: row.id,
    questionId: row.question_id,
    content: row.content,
    summary: row.summary,
    status: row.status as ExplanationStatus,
    turnIds,
    errorMessage: row.error_message ?? undefined,
    createdAt: row.created_at,
    usage: usageOf(row.input_tokens, row.output_tokens),
    promptLog,
  };
}

function toRevision(row: RevisionRow): SolutionRevision {
  return {
    id: row.id,
    questionId: row.question_id,
    revisionNumber: row.revision_number,
    steps: JSON.parse(row.steps) as SolutionStepDraft[],
    createdAt: row.created_at,
    createdBy:
      row.created_by === "manual"
        ? "manual"
        : row.created_by === "archive"
          ? "archive"
          : "ai",
  };
}

function toProposal(row: ProposalRow): ArchiveProposal {
  return {
    id: row.id,
    subConversationId: row.sub_conversation_id,
    questionId: row.question_id,
    status: row.status as ArchiveProposalStatus,
    summary: row.summary,
    changes: JSON.parse(row.changes) as ArchiveChange[],
    sourceTurnIds: JSON.parse(row.source_turn_ids) as string[],
    createdAt: row.created_at,
    appliedAt: row.applied_at ?? undefined,
  };
}

export class WorkspaceRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  getWorkspace(): WorkspaceData {
    const groupRows = this.db
      .prepare("SELECT * FROM question_groups ORDER BY position, created_at")
      .all() as unknown as GroupRow[];
    const questionRows = this.db
      .prepare("SELECT * FROM questions ORDER BY group_id, position, created_at")
      .all() as unknown as QuestionRow[];
    const stepRows = this.db
      .prepare("SELECT * FROM solution_steps ORDER BY question_id, step_order")
      .all() as unknown as StepRow[];
    const subRows = this.db
      .prepare("SELECT * FROM sub_conversations ORDER BY created_at")
      .all() as unknown as SubRow[];
    const turnRows = this.db
      .prepare("SELECT * FROM conversation_turns ORDER BY sub_conversation_id, created_at")
      .all() as unknown as TurnRow[];
    const tagRows = this.db
      .prepare("SELECT * FROM turn_step_tags ORDER BY created_at")
      .all() as unknown as TagRow[];
    const explanationRows = this.db
      .prepare("SELECT * FROM solution_explanations ORDER BY created_at DESC")
      .all() as unknown as ExplanationRow[];
    const explanationTurnRows = this.db
      .prepare("SELECT explanation_id, turn_id FROM explanation_turns ORDER BY rowid")
      .all() as unknown as Array<{ explanation_id: string; turn_id: string }>;
    const questionAssetRows = this.db
      .prepare(
        `SELECT links.question_id, assets.id, assets.mime_type, assets.file_size,
                assets.created_at
         FROM question_assets links
         JOIN assets ON assets.id = links.asset_id
         ORDER BY links.question_id, links.position, links.created_at`,
      )
      .all() as unknown as Array<{
      question_id: string;
      id: string;
      mime_type: string;
      file_size: number;
      created_at: number;
    }>;

    const questionIdsByGroup = new Map<string, string[]>();
    for (const row of questionRows) {
      const list = questionIdsByGroup.get(row.group_id) ?? [];
      list.push(row.id);
      questionIdsByGroup.set(row.group_id, list);
    }

    const stepIdsByQuestion = new Map<string, string[]>();
    for (const row of stepRows) {
      const list = stepIdsByQuestion.get(row.question_id) ?? [];
      list.push(row.id);
      stepIdsByQuestion.set(row.question_id, list);
    }

    const turnIdsBySub = new Map<string, string[]>();
    for (const row of turnRows) {
      const list = turnIdsBySub.get(row.sub_conversation_id) ?? [];
      list.push(row.id);
      turnIdsBySub.set(row.sub_conversation_id, list);
    }

    const turnIdsByExplanation = new Map<string, string[]>();
    for (const row of explanationTurnRows) {
      const list = turnIdsByExplanation.get(row.explanation_id) ?? [];
      list.push(row.turn_id);
      turnIdsByExplanation.set(row.explanation_id, list);
    }

    const assetsByQuestion = new Map<string, QuestionAsset[]>();
    for (const row of questionAssetRows) {
      const list = assetsByQuestion.get(row.question_id) ?? [];
      list.push(toQuestionAsset(row));
      assetsByQuestion.set(row.question_id, list);
    }

    return {
      groups: groupRows.map((row) => toGroup(row, questionIdsByGroup.get(row.id) ?? [])),
      questions: questionRows.map((row) =>
        toQuestion(
          row,
          stepIdsByQuestion.get(row.id) ?? [],
          assetsByQuestion.get(row.id) ?? [],
        ),
      ),
      steps: stepRows.map(toStep),
      subs: subRows.map((row) => toSub(row, turnIdsBySub.get(row.id) ?? [])),
      turns: turnRows.map(toTurn),
      tags: tagRows.map(toTag),
      explanations: explanationRows.map((row) =>
        toExplanation(row, turnIdsByExplanation.get(row.id) ?? []),
      ),
    };
  }

  createGroup(title: string): QuestionGroup {
    const now = Date.now();
    const id = randomUUID();
    const { next } = this.db
      .prepare("SELECT COALESCE(MAX(position), -1) + 1 AS next FROM question_groups")
      .get() as { next: number };

    this.db
      .prepare(
        `INSERT INTO question_groups (id, title, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, title, next, now, now);

    return { id, title, questionIds: [], createdAt: now, updatedAt: now };
  }

  renameGroup(groupId: string, title: string): QuestionGroup {
    this.requireGroup(groupId);
    const updatedAt = Date.now();
    this.db
      .prepare("UPDATE question_groups SET title = ?, updated_at = ? WHERE id = ?")
      .run(title, updatedAt, groupId);
    const row = this.requireGroup(groupId);
    const questionIds = this.db
      .prepare("SELECT id FROM questions WHERE group_id = ? ORDER BY position, created_at")
      .all(groupId) as unknown as Array<{ id: string }>;
    return toGroup(row, questionIds.map((item) => item.id));
  }

  deleteGroup(groupId: string): void {
    this.requireGroup(groupId);
    this.db.prepare("DELETE FROM question_groups WHERE id = ?").run(groupId);
  }

  getQuestion(questionId: string): Question {
    const row = this.requireQuestion(questionId);
    const stepIds = this.db
      .prepare("SELECT id FROM solution_steps WHERE question_id = ? ORDER BY step_order")
      .all(questionId) as unknown as Array<{ id: string }>;
    return toQuestion(
      row,
      stepIds.map((item) => item.id),
      this.listQuestionAssets(questionId),
    );
  }

  createQuestion(groupId: string, content: string): Question {
    this.requireGroup(groupId);
    const now = Date.now();
    const id = randomUUID();
    const { next } = this.db
      .prepare(
        "SELECT COALESCE(MAX(position), -1) + 1 AS next FROM questions WHERE group_id = ?",
      )
      .get(groupId) as { next: number };

    this.db
      .prepare(
        `INSERT INTO questions (id, group_id, content, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, groupId, content, next, now, now);
    this.db
      .prepare("UPDATE question_groups SET updated_at = ? WHERE id = ?")
      .run(now, groupId);

    return {
      id,
      groupId,
      content,
      solutionStepIds: [],
      imagePolicy: "auto",
      assets: [],
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * 批量导入题目：existing 加入已有题组，否则按 groupTitle（或默认名）新建题组。
   * 事务保证「新建组 + 批量建题」的原子性。
   */
  importQuestions(
    target: { groupId?: string; groupTitle?: string },
    contents: string[],
  ): ImportedQuestionsResult {
    return withTransaction(this.db, () => {
      let groupId: string;
      let groupTitle: string;
      if (target.groupId) {
        const group = this.requireGroup(target.groupId);
        groupId = group.id;
        groupTitle = group.title;
      } else {
        const now = new Date();
        const pad = (value: number) => String(value).padStart(2, "0");
        const fallback = `拍照导入 ${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        const created = this.createGroup(target.groupTitle?.trim() || fallback);
        groupId = created.id;
        groupTitle = created.title;
      }

      const questions = contents.map((content) => this.createQuestion(groupId, content));
      return { groupId, groupTitle, questions };
    });
  }

  listGroupSummaries(): GroupSummary[] {
    const rows = this.db
      .prepare(
        `SELECT g.id, g.title, COUNT(q.id) AS question_count
         FROM question_groups g
         LEFT JOIN questions q ON q.group_id = g.id
         GROUP BY g.id
         ORDER BY g.position, g.created_at`,
      )
      .all() as unknown as Array<{ id: string; title: string; question_count: number }>;
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      questionCount: row.question_count,
    }));
  }

  updateQuestion(questionId: string, patch: QuestionPatch): Question {
    const row = this.requireQuestion(questionId);
    const now = Date.now();
    const content = patch.content ?? row.content;
    let groupId = row.group_id;
    let position = row.position;

    if (patch.groupId && patch.groupId !== row.group_id) {
      this.requireGroup(patch.groupId);
      const { next } = this.db
        .prepare(
          "SELECT COALESCE(MAX(position), -1) + 1 AS next FROM questions WHERE group_id = ?",
        )
        .get(patch.groupId) as { next: number };
      groupId = patch.groupId;
      position = next;
    }

    this.db
      .prepare(
        `UPDATE questions SET group_id = ?, content = ?, position = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(groupId, content, position, now, questionId);

    const stepIds = this.db
      .prepare("SELECT id FROM solution_steps WHERE question_id = ? ORDER BY step_order")
      .all(questionId) as unknown as Array<{ id: string }>;

    return toQuestion(
      {
        ...row,
        group_id: groupId,
        content,
        position,
        updated_at: now,
      },
      stepIds.map((item) => item.id),
      this.listQuestionAssets(questionId),
    );
  }

  deleteQuestion(questionId: string): void {
    this.requireQuestion(questionId);
    this.db.prepare("DELETE FROM questions WHERE id = ?").run(questionId);
  }

  createStep(questionId: string, input: StepInput): SolutionStep {
    this.requireQuestion(questionId);
    const now = Date.now();
    const id = randomUUID();

    let order = input.order;
    if (order === undefined) {
      const { next } = this.db
        .prepare(
          "SELECT COALESCE(MAX(step_order), 0) + 1 AS next FROM solution_steps WHERE question_id = ?",
        )
        .get(questionId) as { next: number };
      order = next;
    } else {
      const { maxOrder } = this.db
        .prepare(
          "SELECT COALESCE(MAX(step_order), 0) AS maxOrder FROM solution_steps WHERE question_id = ?",
        )
        .get(questionId) as { maxOrder: number };
      if (order > maxOrder + 1) {
        throw new HttpError(400, "INVALID_FIELD", `步骤序号不能超过 ${maxOrder + 1}`);
      }
      const existing = this.db
        .prepare("SELECT id FROM solution_steps WHERE question_id = ? AND step_order = ?")
        .get(questionId, order);
      if (existing) {
        throw new HttpError(409, "STEP_ORDER_CONFLICT", "该步骤序号已被占用");
      }
    }

    this.db
      .prepare(
        `INSERT INTO solution_steps (id, question_id, step_order, title, content, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, questionId, order, input.title, input.content, now);
    this.db
      .prepare("UPDATE questions SET updated_at = ? WHERE id = ?")
      .run(now, questionId);

    return {
      id,
      questionId,
      order,
      title: input.title,
      content: input.content,
      updatedAt: now,
    };
  }

  updateStep(stepId: string, patch: StepPatch): SolutionStep {
    const row = this.requireStep(stepId);
    const now = Date.now();
    const title = patch.title ?? row.title;
    const content = patch.content ?? row.content;
    let order = row.step_order;

    if (patch.order !== undefined && patch.order !== row.step_order) {
      order = patch.order;
      const oldOrder = row.step_order;
      const { maxOrder } = this.db
        .prepare(
          "SELECT COALESCE(MAX(step_order), 0) AS maxOrder FROM solution_steps WHERE question_id = ?",
        )
        .get(row.question_id) as { maxOrder: number };

      if (order > maxOrder) {
        throw new HttpError(400, "INVALID_FIELD", `步骤序号不能超过 ${maxOrder}`);
      }

      const movingBackward = order < oldOrder;
      const rangeStart = movingBackward ? order : oldOrder + 1;
      const rangeEnd = movingBackward ? oldOrder - 1 : order;

      withTransaction(this.db, () => {
        // 先把目标步骤挪到临时序号，再整体平移区间，最后落回目标序号
        this.db
          .prepare("UPDATE solution_steps SET step_order = ? WHERE id = ?")
          .run(REORDER_MARK, stepId);

        if (rangeStart <= rangeEnd) {
          this.db
            .prepare(
              `UPDATE solution_steps SET step_order = step_order + ${REORDER_OFFSET}
               WHERE question_id = ? AND step_order BETWEEN ? AND ?`,
            )
            .run(row.question_id, rangeStart, rangeEnd);
          this.db
            .prepare(
              `UPDATE solution_steps SET step_order = step_order - ${
                REORDER_OFFSET + (movingBackward ? -1 : 1)
              }
               WHERE question_id = ? AND step_order BETWEEN ? AND ?`,
            )
            .run(
              row.question_id,
              rangeStart + REORDER_OFFSET,
              rangeEnd + REORDER_OFFSET,
            );
        }

        this.db
          .prepare("UPDATE solution_steps SET step_order = ?, updated_at = ? WHERE id = ?")
          .run(order, now, stepId);
      });
    } else {
      this.db
        .prepare("UPDATE solution_steps SET title = ?, content = ?, updated_at = ? WHERE id = ?")
        .run(title, content, now, stepId);
    }

    const updated = this.requireStep(stepId);
    return toStep(updated);
  }

  deleteStep(stepId: string): void {
    this.requireStep(stepId);
    this.db.prepare("DELETE FROM solution_steps WHERE id = ?").run(stepId);
  }

  replaceSteps(
    questionId: string,
    drafts: SolutionStepDraft[],
    createdBy: SolutionRevisionCreator = "ai",
  ): SolutionGenerationResult {
    this.requireQuestion(questionId);

    return withTransaction(this.db, () => {
      const now = Date.now();
      this.db
        .prepare("DELETE FROM solution_steps WHERE question_id = ?")
        .run(questionId);

      const insert = this.db.prepare(
        `INSERT INTO solution_steps (id, question_id, step_order, title, content, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      const steps: SolutionStep[] = drafts.map((draft, index) => {
        const id = randomUUID();
        const order = index + 1;
        insert.run(id, questionId, order, draft.title, draft.content, now);
        return {
          id,
          questionId,
          order,
          title: draft.title,
          content: draft.content,
          updatedAt: now,
        };
      });

      const revision = this.writeRevision(questionId, drafts, createdBy, now);
      this.db
        .prepare("UPDATE questions SET updated_at = ? WHERE id = ?")
        .run(now, questionId);

      return { steps, revision };
    });
  }

  private writeRevision(
    questionId: string,
    drafts: SolutionStepDraft[],
    createdBy: SolutionRevisionCreator,
    now: number,
  ): SolutionRevision {
    const { next } = this.db
      .prepare(
        "SELECT COALESCE(MAX(revision_number), 0) + 1 AS next FROM solution_revisions WHERE question_id = ?",
      )
      .get(questionId) as { next: number };

    const revisionId = randomUUID();
    const snapshot = drafts.map((draft) => ({
      title: draft.title,
      content: draft.content,
    }));
    this.db
      .prepare(
        `INSERT INTO solution_revisions (
           id, question_id, revision_number, steps, created_at, created_by
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(revisionId, questionId, next, JSON.stringify(snapshot), now, createdBy);

    return {
      id: revisionId,
      questionId,
      revisionNumber: next,
      steps: snapshot,
      createdAt: now,
      createdBy,
    };
  }

  listRevisions(questionId: string): SolutionRevision[] {
    this.requireQuestion(questionId);
    const rows = this.db
      .prepare(
        "SELECT * FROM solution_revisions WHERE question_id = ? ORDER BY revision_number DESC",
      )
      .all(questionId) as unknown as RevisionRow[];
    return rows.map(toRevision);
  }

  getRevision(questionId: string, revisionId: string): SolutionRevision {
    const row = this.db
      .prepare(
        "SELECT * FROM solution_revisions WHERE id = ? AND question_id = ?",
      )
      .get(revisionId, questionId) as unknown as RevisionRow | undefined;
    if (!row) throw new HttpError(404, "NOT_FOUND", "题解版本不存在");
    return toRevision(row);
  }

  getConversationByStep(stepId: string): ConversationView {
    this.requireStep(stepId);
    const subRow = this.db
      .prepare("SELECT * FROM sub_conversations WHERE entry_step_id = ?")
      .get(stepId) as unknown as SubRow | undefined;
    if (!subRow) {
      return { subConversation: null, turns: [], tags: [] };
    }

    const turnRows = this.db
      .prepare(
        "SELECT * FROM conversation_turns WHERE sub_conversation_id = ? ORDER BY created_at",
      )
      .all(subRow.id) as unknown as TurnRow[];
    const tagRows = this.db
      .prepare(
        `SELECT tags.* FROM turn_step_tags tags
         JOIN conversation_turns turns ON turns.id = tags.turn_id
         WHERE turns.sub_conversation_id = ?
         ORDER BY tags.created_at`,
      )
      .all(subRow.id) as unknown as TagRow[];

    return {
      subConversation: toSub(
        subRow,
        turnRows.map((row) => row.id),
      ),
      turns: turnRows.map(toTurn),
      tags: tagRows.map(toTag),
    };
  }

  getChatContext(stepId: string, limit = 10): ChatContextData {
    const entryRow = this.requireStep(stepId);
    const questionRow = this.requireQuestion(entryRow.question_id);

    const stepRows = this.db
      .prepare("SELECT * FROM solution_steps WHERE question_id = ? ORDER BY step_order")
      .all(entryRow.question_id) as unknown as StepRow[];
    const steps = stepRows.map(toStep);
    const entryStep = steps.find((step) => step.id === stepId) ?? toStep(entryRow);

    const subRow = this.db
      .prepare("SELECT * FROM sub_conversations WHERE entry_step_id = ?")
      .get(stepId) as unknown as SubRow | undefined;

    let history: ConversationTurn[] = [];
    if (subRow) {
      const rows = this.db
        .prepare(
          `SELECT * FROM conversation_turns
           WHERE sub_conversation_id = ?
           ORDER BY created_at DESC, rowid DESC
           LIMIT ?`,
        )
        .all(subRow.id, limit) as unknown as TurnRow[];
      history = rows.reverse().map(toTurn);
    }

    return {
      question: toQuestion(
        questionRow,
        steps.map((step) => step.id),
        this.listQuestionAssets(questionRow.id),
      ),
      steps,
      entryStep,
      history,
    };
  }

  getArchiveContext(subConversationId: string): ArchiveContextData {
    const subRow = this.requireSub(subConversationId);
    const entryRow = this.requireStep(subRow.entry_step_id);
    const questionRow = this.requireQuestion(entryRow.question_id);

    const stepRows = this.db
      .prepare("SELECT * FROM solution_steps WHERE question_id = ? ORDER BY step_order")
      .all(entryRow.question_id) as unknown as StepRow[];
    const steps = stepRows.map(toStep);

    const turnRows = this.db
      .prepare(
        "SELECT * FROM conversation_turns WHERE sub_conversation_id = ? ORDER BY created_at, rowid",
      )
      .all(subConversationId) as unknown as TurnRow[];
    const tagRows = this.db
      .prepare(
        `SELECT tags.* FROM turn_step_tags tags
         JOIN conversation_turns turns ON turns.id = tags.turn_id
         WHERE turns.sub_conversation_id = ?
         ORDER BY tags.created_at`,
      )
      .all(subConversationId) as unknown as TagRow[];

    return {
      question: toQuestion(
        questionRow,
        steps.map((step) => step.id),
        this.listQuestionAssets(questionRow.id),
      ),
      steps,
      entryStep: steps.find((step) => step.id === entryRow.id) ?? toStep(entryRow),
      discussion: toSub(
        subRow,
        turnRows.map((row) => row.id),
      ),
      turns: turnRows.map(toTurn),
      tags: tagRows.map(toTag),
    };
  }

  createArchiveProposal(input: CreateArchiveProposalInput): ArchiveProposal {
    this.requireSub(input.subConversationId);
    this.requireQuestion(input.questionId);
    const id = randomUUID();
    const now = Date.now();

    this.db
      .prepare(
        `INSERT INTO archive_proposals (
           id, sub_conversation_id, question_id, status, summary, changes,
           source_turn_ids, created_at
         ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.subConversationId,
        input.questionId,
        input.summary,
        JSON.stringify(input.changes),
        JSON.stringify(input.sourceTurnIds),
        now,
      );

    return this.requireProposal(id);
  }

  getArchiveProposal(proposalId: string): ArchiveProposal {
    return this.requireProposal(proposalId);
  }

  listArchiveProposals(questionId: string): ArchiveProposal[] {
    this.requireQuestion(questionId);
    const rows = this.db
      .prepare(
        "SELECT * FROM archive_proposals WHERE question_id = ? ORDER BY created_at DESC",
      )
      .all(questionId) as unknown as ProposalRow[];
    return rows.map(toProposal);
  }

  rejectArchiveProposal(proposalId: string): ArchiveProposal {
    const row = this.requireProposalRow(proposalId);
    if (row.status !== "pending") {
      throw new HttpError(409, "PROPOSAL_NOT_PENDING", "该提案已处理，不能重复操作");
    }
    this.db
      .prepare("UPDATE archive_proposals SET status = 'rejected' WHERE id = ?")
      .run(proposalId);
    return this.requireProposal(proposalId);
  }

  applyArchiveProposal(proposalId: string): ArchiveApplyResult {
    return withTransaction(this.db, () => {
      const row = this.requireProposalRow(proposalId);
      if (row.status !== "pending") {
        throw new HttpError(409, "PROPOSAL_NOT_PENDING", "该提案已处理，不能重复应用");
      }

      const questionId = row.question_id;
      this.requireQuestion(questionId);

      const stepRows = this.db
        .prepare("SELECT * FROM solution_steps WHERE question_id = ? ORDER BY step_order")
        .all(questionId) as unknown as StepRow[];
      const stepMap = new Map(stepRows.map((step) => [step.id, step]));
      const changes = JSON.parse(row.changes) as ArchiveChange[];
      const now = Date.now();
      let effective = 0;

      for (const change of changes) {
        if (change.action !== "add_explanation" && change.action !== "revise_content") {
          continue;
        }
        const step = stepMap.get(change.stepId);
        if (!step) {
          throw new HttpError(
            409,
            "PROPOSAL_CONFLICT",
            "提案中的步骤已不存在，请重新生成提案",
          );
        }
        const proposed = change.proposedContent?.trim();
        if (!proposed) {
          throw new HttpError(
            409,
            "PROPOSAL_CONFLICT",
            "提案缺少可应用的内容，请重新生成提案",
          );
        }

        const content =
          change.action === "add_explanation"
            ? `${step.content}\n\n${proposed}`
            : proposed;
        this.db
          .prepare("UPDATE solution_steps SET content = ?, updated_at = ? WHERE id = ?")
          .run(content, now, step.id);
        step.content = content;
        effective += 1;
      }

      let revision: SolutionRevision | null = null;
      if (effective > 0) {
        const drafts = stepRows.map((step) => ({
          title: step.title,
          content: step.content,
        }));
        revision = this.writeRevision(questionId, drafts, "archive", now);
        this.db
          .prepare("UPDATE questions SET updated_at = ? WHERE id = ?")
          .run(now, questionId);
      }

      this.db
        .prepare(
          "UPDATE archive_proposals SET status = 'applied', applied_at = ? WHERE id = ?",
        )
        .run(now, proposalId);

      const sourceTurnIds = JSON.parse(row.source_turn_ids) as string[];
      const markTurn = this.db.prepare(
        "UPDATE conversation_turns SET archive_status = 'archived' WHERE id = ?",
      );
      for (const turnId of sourceTurnIds) markTurn.run(turnId);

      const finalRows = this.db
        .prepare("SELECT * FROM solution_steps WHERE question_id = ? ORDER BY step_order")
        .all(questionId) as unknown as StepRow[];

      return {
        steps: finalRows.map(toStep),
        revision,
        proposal: this.requireProposal(proposalId),
      };
    });
  }

  appendTurn(
    stepId: string,
    userMessage: string,
    assistantMessage: string,
    options: AppendTurnOptions = {},
  ): AppendedTurn {
    this.requireStep(stepId);

    return withTransaction(this.db, () => {
      const now = Date.now();
      let subRow = this.db
        .prepare("SELECT * FROM sub_conversations WHERE entry_step_id = ?")
        .get(stepId) as unknown as SubRow | undefined;

      if (!subRow) {
        const subId = randomUUID();
        this.db
          .prepare(
            `INSERT INTO sub_conversations (id, entry_step_id, created_at, updated_at)
             VALUES (?, ?, ?, ?)`,
          )
          .run(subId, stepId, now, now);
        subRow = {
          id: subId,
          entry_step_id: stepId,
          created_at: now,
          updated_at: now,
        };
      }

      const turnId = randomUUID();
      this.db
        .prepare(
          `INSERT INTO conversation_turns (
             id, sub_conversation_id, user_message, assistant_message, created_at,
             archive_status, tag_status, generation_status,
             chat_input_tokens, chat_output_tokens
           ) VALUES (?, ?, ?, ?, ?, 'unarchived', 'tagged', ?, ?, ?)`,
        )
        .run(
          turnId,
          subRow.id,
          userMessage,
          assistantMessage,
          now,
          options.generationStatus ?? "completed",
          options.chatUsage?.inputTokens ?? null,
          options.chatUsage?.outputTokens ?? null,
        );

      const tagId = randomUUID();
      this.db
        .prepare(
          `INSERT INTO turn_step_tags (id, turn_id, step_id, relevance, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(tagId, turnId, stepId, "由入口步骤自动关联", now);

      this.db
        .prepare("UPDATE sub_conversations SET updated_at = ? WHERE id = ?")
        .run(now, subRow.id);

      const turnRow = this.db
        .prepare("SELECT * FROM conversation_turns WHERE id = ?")
        .get(turnId) as unknown as TurnRow;
      const tagRow = this.db
        .prepare("SELECT * FROM turn_step_tags WHERE id = ?")
        .get(tagId) as unknown as TagRow;
      const turnIds = this.db
        .prepare("SELECT id FROM conversation_turns WHERE sub_conversation_id = ? ORDER BY created_at")
        .all(subRow.id) as unknown as Array<{ id: string }>;

      return {
        subConversation: toSub(
          { ...subRow, updated_at: now },
          turnIds.map((item) => item.id),
        ),
        turn: toTurn(turnRow),
        tags: [toTag(tagRow)],
      };
    });
  }

  createExplanation(questionId: string, input: ExplanationInput): SolutionExplanation {
    this.requireQuestion(questionId);
    const turnIds = input.turnIds ?? [];

    for (const turnId of turnIds) {
      const exists = this.db
        .prepare("SELECT id FROM conversation_turns WHERE id = ?")
        .get(turnId);
      if (!exists) {
        throw new HttpError(400, "INVALID_TURN", `讨论轮次不存在：${turnId}`);
      }
    }

    const id = randomUUID();
    const createdAt = Date.now();
    const status = input.status ?? "completed";

    withTransaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO solution_explanations (
             id, question_id, content, summary, status, error_message, created_at,
             input_tokens, output_tokens, prompt_system, prompt_user, prompt_estimated_tokens
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          questionId,
          input.content,
          input.summary,
          status,
          input.errorMessage ?? null,
          createdAt,
          input.usage?.inputTokens ?? null,
          input.usage?.outputTokens ?? null,
          input.promptLog?.system ?? null,
          input.promptLog?.user ?? null,
          input.promptLog?.estimatedTokens ?? null,
        );

      const turnStmt = this.db.prepare(
        "INSERT INTO explanation_turns (explanation_id, turn_id) VALUES (?, ?)",
      );
      for (const turnId of turnIds) turnStmt.run(id, turnId);
    });

    const row = this.db
      .prepare("SELECT * FROM solution_explanations WHERE id = ?")
      .get(id) as unknown as ExplanationRow;
    return toExplanation(row, turnIds);
  }

  deleteExplanation(explanationId: string): void {
    const row = this.db
      .prepare("SELECT id FROM solution_explanations WHERE id = ?")
      .get(explanationId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "题目详解不存在");
    this.db.prepare("DELETE FROM solution_explanations WHERE id = ?").run(explanationId);
  }

  getQuestionExport(questionId: string): QuestionExportData {
    const row = this.requireQuestion(questionId);
    const groupRow = this.db
      .prepare("SELECT title FROM question_groups WHERE id = ?")
      .get(row.group_id) as { title: string } | undefined;
    return this.readQuestionExport(row, groupRow?.title ?? "未命名题组");
  }

  getGroupTitle(groupId: string): string {
    return this.requireGroup(groupId).title;
  }

  getGroupExport(groupId: string): GroupExportData {
    const group = this.requireGroup(groupId);
    const rows = this.db
      .prepare("SELECT * FROM questions WHERE group_id = ? ORDER BY position, created_at")
      .all(groupId) as unknown as QuestionRow[];
    return {
      groupTitle: group.title,
      questions: rows.map((row) => this.readQuestionExport(row, group.title)),
    };
  }

  private readQuestionExport(row: QuestionRow, groupTitle: string): QuestionExportData {
    const stepRows = this.db
      .prepare("SELECT * FROM solution_steps WHERE question_id = ? ORDER BY step_order")
      .all(row.id) as unknown as StepRow[];
    const explanationRows = this.db
      .prepare(
        "SELECT * FROM solution_explanations WHERE question_id = ? ORDER BY created_at",
      )
      .all(row.id) as unknown as ExplanationRow[];
    const turnRows = this.db
      .prepare(
        `SELECT turns.explanation_id AS explanation_id, turns.turn_id AS turn_id
         FROM explanation_turns turns
         JOIN solution_explanations explanations ON explanations.id = turns.explanation_id
         WHERE explanations.question_id = ?
         ORDER BY turns.rowid`,
      )
      .all(row.id) as unknown as Array<{ explanation_id: string; turn_id: string }>;

    const turnIdsByExplanation = new Map<string, string[]>();
    for (const turnRow of turnRows) {
      const list = turnIdsByExplanation.get(turnRow.explanation_id) ?? [];
      list.push(turnRow.turn_id);
      turnIdsByExplanation.set(turnRow.explanation_id, list);
    }

    return {
      groupTitle,
      question: toQuestion(
        row,
        stepRows.map((step) => step.id),
        this.listQuestionAssets(row.id),
      ),
      steps: stepRows.map(toStep),
      explanations: explanationRows.map((explanation) =>
        toExplanation(explanation, turnIdsByExplanation.get(explanation.id) ?? []),
      ),
    };
  }

  exportBackup(): BackupPayload {
    return { version: 1, exportedAt: Date.now(), data: this.getWorkspace() };
  }

  replaceWorkspace(data: WorkspaceData): WorkspaceData {
    withTransaction(this.db, () => {
      this.db.exec(`
        DELETE FROM explanation_turns;
        DELETE FROM turn_step_tags;
        DELETE FROM conversation_turns;
        DELETE FROM archive_proposals;
        DELETE FROM sub_conversations;
        DELETE FROM solution_explanations;
        DELETE FROM solution_revisions;
        DELETE FROM solution_steps;
        DELETE FROM questions;
        DELETE FROM question_groups;
      `);
      insertWorkspaceData(this.db, data);
    });

    return this.getWorkspace();
  }

  // ---------- 题目图片资源 ----------

  findAssetBySha256(sha256: string): AssetRow | undefined {
    return this.db
      .prepare("SELECT * FROM assets WHERE sha256 = ? LIMIT 1")
      .get(sha256) as unknown as AssetRow | undefined;
  }

  getAsset(assetId: string): AssetRow | undefined {
    return this.db
      .prepare("SELECT * FROM assets WHERE id = ?")
      .get(assetId) as unknown as AssetRow | undefined;
  }

  createAsset(input: NewAsset): AssetRow {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO assets (
           id, storage_path, mime_type, file_size, sha256, status, created_at
         ) VALUES (?, ?, ?, ?, ?, 'ready', ?)`,
      )
      .run(id, input.storagePath, input.mimeType, input.fileSize, input.sha256, now);
    return this.getAsset(id) as AssetRow;
  }

  deleteAssetRecord(assetId: string): void {
    this.db.prepare("DELETE FROM assets WHERE id = ?").run(assetId);
  }

  listQuestionAssets(questionId: string): QuestionAsset[] {
    const rows = this.db
      .prepare(
        `SELECT assets.id, assets.mime_type, assets.file_size, assets.created_at
         FROM question_assets links
         JOIN assets ON assets.id = links.asset_id
         WHERE links.question_id = ?
         ORDER BY links.position, links.created_at`,
      )
      .all(questionId) as unknown as Array<{
      id: string;
      mime_type: string;
      file_size: number;
      created_at: number;
    }>;
    return rows.map(toQuestionAsset);
  }

  linkAssets(questionId: string, assetIds: string[]): void {
    if (assetIds.length === 0) return;
    this.requireQuestion(questionId);
    const now = Date.now();
    const { next } = this.db
      .prepare(
        "SELECT COALESCE(MAX(position), -1) + 1 AS next FROM question_assets WHERE question_id = ?",
      )
      .get(questionId) as { next: number };
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO question_assets (question_id, asset_id, position, role, created_at)
       VALUES (?, ?, ?, 'original', ?)`,
    );
    assetIds.forEach((assetId, index) => {
      insert.run(questionId, assetId, next + index, now);
    });
  }

  /** 解除关联并返回该资源剩余被引用的次数 */
  unlinkQuestionAsset(questionId: string, assetId: string): number {
    const result = this.db
      .prepare("DELETE FROM question_assets WHERE question_id = ? AND asset_id = ?")
      .run(questionId, assetId);
    if (Number(result.changes) === 0) {
      throw new HttpError(404, "NOT_FOUND", "题目图片不存在");
    }
    const { count } = this.db
      .prepare("SELECT COUNT(*) AS count FROM question_assets WHERE asset_id = ?")
      .get(assetId) as { count: number };
    return count;
  }

  setQuestionImagePolicy(questionId: string, imagePolicy: ImagePolicy): Question {
    this.requireQuestion(questionId);
    this.db
      .prepare("UPDATE questions SET image_policy = ?, updated_at = ? WHERE id = ?")
      .run(imagePolicy, Date.now(), questionId);
    return this.getQuestion(questionId);
  }

  /** 题解生成所需的题目文本、图片策略与原图清单 */
  getQuestionContext(questionId: string): QuestionContextSource {
    const row = this.requireQuestion(questionId);
    const assets = this.db
      .prepare(
        `SELECT assets.id, assets.mime_type, assets.storage_path
         FROM question_assets links
         JOIN assets ON assets.id = links.asset_id
         WHERE links.question_id = ?
         ORDER BY links.position, links.created_at`,
      )
      .all(questionId) as unknown as Array<{
      id: string;
      mime_type: string;
      storage_path: string;
    }>;

    return {
      content: row.content,
      imagePolicy: row.image_policy as ImagePolicy,
      assets: assets.map((asset) => ({
        id: asset.id,
        mimeType: asset.mime_type,
        storagePath: asset.storage_path,
      })),
    };
  }

  recordContextSnapshot(input: ContextSnapshotInput): void {
    this.db
      .prepare(
        `INSERT INTO ai_context_snapshots (
           id, question_id, task_type, image_policy, included_asset_ids,
           selection_reason, model, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        input.questionId,
        input.taskType,
        input.imagePolicy,
        JSON.stringify(input.includedAssetIds),
        input.selectionReason,
        input.model,
        Date.now(),
      );
  }

  private requireGroup(groupId: string): GroupRow {
    const row = this.db
      .prepare("SELECT * FROM question_groups WHERE id = ?")
      .get(groupId) as unknown as GroupRow | undefined;
    if (!row) throw new HttpError(404, "NOT_FOUND", "题组不存在");
    return row;
  }

  private requireQuestion(questionId: string): QuestionRow {
    const row = this.db
      .prepare("SELECT * FROM questions WHERE id = ?")
      .get(questionId) as unknown as QuestionRow | undefined;
    if (!row) throw new HttpError(404, "NOT_FOUND", "题目不存在");
    return row;
  }

  private requireStep(stepId: string): StepRow {
    const row = this.db
      .prepare("SELECT * FROM solution_steps WHERE id = ?")
      .get(stepId) as unknown as StepRow | undefined;
    if (!row) throw new HttpError(404, "NOT_FOUND", "步骤不存在");
    return row;
  }

  private requireSub(subConversationId: string): SubRow {
    const row = this.db
      .prepare("SELECT * FROM sub_conversations WHERE id = ?")
      .get(subConversationId) as unknown as SubRow | undefined;
    if (!row) throw new HttpError(404, "NOT_FOUND", "讨论不存在");
    return row;
  }

  private requireProposalRow(proposalId: string): ProposalRow {
    const row = this.db
      .prepare("SELECT * FROM archive_proposals WHERE id = ?")
      .get(proposalId) as unknown as ProposalRow | undefined;
    if (!row) throw new HttpError(404, "NOT_FOUND", "归档提案不存在");
    return row;
  }

  private requireProposal(proposalId: string): ArchiveProposal {
    return toProposal(this.requireProposalRow(proposalId));
  }
}
