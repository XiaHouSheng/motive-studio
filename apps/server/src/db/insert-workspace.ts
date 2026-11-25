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

  // 试卷分组：旧备份没有该字段时按题组各补一个默认试卷分组
  const paperGroups = data.paperGroups ?? [];
  if (paperGroups.length === 0) {
    const paperStmt = db.prepare(
      `INSERT INTO paper_groups (id, group_id, title, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    data.groups.forEach((group) => {
      paperStmt.run(
        `${group.id}-paper-0`,
        group.id,
        "默认试卷",
        0,
        group.createdAt,
        group.updatedAt,
      );
    });
  }
  const paperStmt = db.prepare(
    `INSERT INTO paper_groups (id, group_id, title, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  paperGroups.forEach((paper, index) => {
    paperStmt.run(paper.id, paper.groupId, paper.title, index, paper.createdAt, paper.updatedAt);
  });
  const paperIdsByGroup = new Map<string, string>();
  for (const paper of paperGroups) {
    if (!paperIdsByGroup.has(paper.groupId)) paperIdsByGroup.set(paper.groupId, paper.id);
  }

  const questionPosition = new Map<string, number>();
  for (const group of data.groups) {
    group.questionIds.forEach((questionId, index) => {
      questionPosition.set(questionId, index);
    });
  }

  const questionStmt = db.prepare(
    `INSERT INTO questions (
       id, group_id, paper_group_id, content, position, image_policy, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const question of data.questions) {
    // 试卷分组归属：备份里显式给定的优先，其次按题组首个试卷分组兜底
    const paperGroupId =
      question.paperGroupId ??
      paperIdsByGroup.get(question.groupId) ??
      `${question.groupId}-paper-0`;
    questionStmt.run(
      question.id,
      question.groupId,
      paperGroupId,
      question.content,
      questionPosition.get(question.id) ?? 0,
      question.imagePolicy ?? "auto",
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
       tag_status, generation_status, tag_input_tokens, tag_output_tokens,
       chat_input_tokens, chat_output_tokens
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const turn of data.turns) {
    turnStmt.run(
      turn.id,
      turn.subConversationId,
      turn.userMessage,
      turn.assistantMessage,
      turn.createdAt,
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
