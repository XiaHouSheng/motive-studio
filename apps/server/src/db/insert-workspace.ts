import type { DatabaseSync } from "node:sqlite";
import type { WorkspaceData } from "@motive/shared";

/**
 * 将一份完整的工作区数据写入空表。调用方负责事务与清空旧数据。
 */
export function insertWorkspaceData(db: DatabaseSync, data: WorkspaceData): void {
  const groupStmt = db.prepare(
    `INSERT INTO question_groups (id, title, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  data.groups.forEach((group, index) => {
    groupStmt.run(group.id, group.title, index, group.createdAt, group.updatedAt);
  });

  const questionPosition = new Map<string, number>();
  for (const group of data.groups) {
    group.questionIds.forEach((questionId, index) => {
      questionPosition.set(questionId, index);
    });
  }

  const questionStmt = db.prepare(
    `INSERT INTO questions (id, group_id, content, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const question of data.questions) {
    questionStmt.run(
      question.id,
      question.groupId,
      question.content,
      questionPosition.get(question.id) ?? 0,
      question.createdAt,
      question.updatedAt,
    );
  }

  const stepStmt = db.prepare(
    `INSERT INTO solution_steps (id, question_id, step_order, title, content, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const step of data.steps) {
    stepStmt.run(step.id, step.questionId, step.order, step.title, step.content, step.updatedAt);
  }

  const subStmt = db.prepare(
    `INSERT INTO sub_conversations (id, entry_step_id, created_at, updated_at)
     VALUES (?, ?, ?, ?)`,
  );
  for (const sub of data.subs) {
    subStmt.run(sub.id, sub.entryStepId, sub.createdAt, sub.updatedAt);
  }

  const turnStmt = db.prepare(
    `INSERT INTO conversation_turns (
       id, sub_conversation_id, user_message, assistant_message, created_at,
       archive_status, tag_status, generation_status, tag_input_tokens, tag_output_tokens,
       chat_input_tokens, chat_output_tokens
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const turn of data.turns) {
    turnStmt.run(
      turn.id,
      turn.subConversationId,
      turn.userMessage,
      turn.assistantMessage,
      turn.createdAt,
      turn.archiveStatus,
      turn.tagStatus,
      turn.generationStatus ?? "completed",
      turn.tagUsage?.inputTokens ?? null,
      turn.tagUsage?.outputTokens ?? null,
      turn.chatUsage?.inputTokens ?? null,
      turn.chatUsage?.outputTokens ?? null,
    );
  }

  const tagStmt = db.prepare(
    `INSERT INTO turn_step_tags (id, turn_id, step_id, relevance, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (const tag of data.tags) {
    tagStmt.run(tag.id, tag.turnId, tag.stepId, tag.relevance ?? null, tag.createdAt);
  }

  const explanationStmt = db.prepare(
    `INSERT INTO solution_explanations (
       id, question_id, content, summary, status, error_message, created_at,
       input_tokens, output_tokens, prompt_system, prompt_user, prompt_estimated_tokens
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const explanationTurnStmt = db.prepare(
    `INSERT INTO explanation_turns (explanation_id, turn_id) VALUES (?, ?)`,
  );
  for (const explanation of data.explanations) {
    explanationStmt.run(
      explanation.id,
      explanation.questionId,
      explanation.content,
      explanation.summary,
      explanation.status,
      explanation.errorMessage ?? null,
      explanation.createdAt,
      explanation.usage?.inputTokens ?? null,
      explanation.usage?.outputTokens ?? null,
      explanation.promptLog?.system ?? null,
      explanation.promptLog?.user ?? null,
      explanation.promptLog?.estimatedTokens ?? null,
    );
    for (const turnId of explanation.turnIds) {
      explanationTurnStmt.run(explanation.id, turnId);
    }
  }
}
