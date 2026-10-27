export interface Migration {
  version: number;
  statements: string[];
}

export const migrations: Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE question_groups (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        position INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE INDEX idx_question_groups_position ON question_groups(position)`,

      `CREATE TABLE questions (
        id TEXT PRIMARY KEY,
        group_id TEXT NOT NULL REFERENCES question_groups(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        position INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE INDEX idx_questions_group ON questions(group_id, position)`,

      `CREATE TABLE solution_steps (
        id TEXT PRIMARY KEY,
        question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
        step_order INTEGER NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (question_id, step_order)
      )`,
      `CREATE INDEX idx_solution_steps_question ON solution_steps(question_id, step_order)`,

      `CREATE TABLE sub_conversations (
        id TEXT PRIMARY KEY,
        entry_step_id TEXT NOT NULL UNIQUE REFERENCES solution_steps(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,

      `CREATE TABLE conversation_turns (
        id TEXT PRIMARY KEY,
        sub_conversation_id TEXT NOT NULL REFERENCES sub_conversations(id) ON DELETE CASCADE,
        user_message TEXT NOT NULL,
        assistant_message TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        archive_status TEXT NOT NULL DEFAULT 'unarchived',
        tag_status TEXT NOT NULL DEFAULT 'tagged',
        tag_input_tokens INTEGER,
        tag_output_tokens INTEGER,
        chat_input_tokens INTEGER,
        chat_output_tokens INTEGER
      )`,
      `CREATE INDEX idx_conversation_turns_sub ON conversation_turns(sub_conversation_id, created_at)`,

      `CREATE TABLE turn_step_tags (
        id TEXT PRIMARY KEY,
        turn_id TEXT NOT NULL REFERENCES conversation_turns(id) ON DELETE CASCADE,
        step_id TEXT NOT NULL REFERENCES solution_steps(id) ON DELETE CASCADE,
        relevance TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE (turn_id, step_id)
      )`,
      `CREATE INDEX idx_turn_step_tags_turn ON turn_step_tags(turn_id)`,

      `CREATE TABLE solution_explanations (
        id TEXT PRIMARY KEY,
        question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        summary TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'completed',
        error_message TEXT,
        created_at INTEGER NOT NULL,
        input_tokens INTEGER,
        output_tokens INTEGER,
        prompt_system TEXT,
        prompt_user TEXT,
        prompt_estimated_tokens INTEGER
      )`,
      `CREATE INDEX idx_solution_explanations_question ON solution_explanations(question_id, created_at)`,

      `CREATE TABLE explanation_turns (
        explanation_id TEXT NOT NULL REFERENCES solution_explanations(id) ON DELETE CASCADE,
        turn_id TEXT NOT NULL REFERENCES conversation_turns(id) ON DELETE CASCADE,
        PRIMARY KEY (explanation_id, turn_id)
      )`,

      `CREATE TABLE app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`,
    ],
  },
  {
    version: 2,
    statements: [
      `CREATE TABLE app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
      `ALTER TABLE conversation_turns
        ADD COLUMN generation_status TEXT NOT NULL DEFAULT 'completed'`,
    ],
  },
  {
    version: 3,
    statements: [
      `CREATE TABLE solution_revisions (
        id TEXT PRIMARY KEY,
        question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
        revision_number INTEGER NOT NULL,
        steps TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        created_by TEXT NOT NULL,
        UNIQUE (question_id, revision_number)
      )`,
      `CREATE INDEX idx_solution_revisions_question
        ON solution_revisions(question_id, revision_number)`,
    ],
  },
  {
    version: 4,
    statements: [
      `CREATE TABLE archive_proposals (
        id TEXT PRIMARY KEY,
        sub_conversation_id TEXT NOT NULL REFERENCES sub_conversations(id) ON DELETE CASCADE,
        question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pending',
        summary TEXT NOT NULL,
        changes TEXT NOT NULL,
        source_turn_ids TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        applied_at INTEGER
      )`,
      `CREATE INDEX idx_archive_proposals_question
        ON archive_proposals(question_id, created_at)`,
    ],
  },
  {
    version: 5,
    statements: [
      `CREATE TABLE assets (
        id TEXT PRIMARY KEY,
        storage_path TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        width INTEGER,
        height INTEGER,
        status TEXT NOT NULL DEFAULT 'ready',
        created_at INTEGER NOT NULL
      )`,
      `CREATE INDEX idx_assets_sha256 ON assets(sha256)`,

      `CREATE TABLE question_assets (
        question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
        asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        role TEXT NOT NULL DEFAULT 'original',
        created_at INTEGER NOT NULL,
        PRIMARY KEY (question_id, asset_id)
      )`,
      `CREATE INDEX idx_question_assets_question
        ON question_assets(question_id, position)`,

      `ALTER TABLE questions ADD COLUMN image_policy TEXT NOT NULL DEFAULT 'auto'`,

      `CREATE TABLE ai_context_snapshots (
        id TEXT PRIMARY KEY,
        question_id TEXT NOT NULL,
        task_type TEXT NOT NULL,
        image_policy TEXT NOT NULL,
        included_asset_ids TEXT NOT NULL,
        selection_reason TEXT NOT NULL,
        model TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
      `CREATE INDEX idx_ai_context_snapshots_question
        ON ai_context_snapshots(question_id, created_at)`,
    ],
  },
];
