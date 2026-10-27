import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { insertWorkspaceData } from "./insert-workspace.js";
import { migrations } from "./migrations.js";
import { createSeedWorkspace } from "./seed.js";

export function withTransaction<T>(db: DatabaseSync, run: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = run();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function openDatabase(filePath: string): DatabaseSync {
  if (filePath !== ":memory:") {
    mkdirSync(path.dirname(filePath), { recursive: true });
  }

  const db = new DatabaseSync(filePath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");

  migrate(db);
  seedOnce(db);

  return db;
}

function migrate(db: DatabaseSync): void {
  const row = db.prepare("PRAGMA user_version").get() as
    | { user_version: number }
    | undefined;
  const current = row?.user_version ?? 0;

  for (const migration of migrations) {
    if (migration.version <= current) continue;
    withTransaction(db, () => {
      for (const statement of migration.statements) db.exec(statement);
      db.exec(`PRAGMA user_version = ${migration.version}`);
    });
  }
}

function seedOnce(db: DatabaseSync): void {
  const seeded = db
    .prepare("SELECT value FROM app_meta WHERE key = 'seeded'")
    .get() as { value: string } | undefined;
  if (seeded) return;

  withTransaction(db, () => {
    insertWorkspaceData(db, createSeedWorkspace());
    db.prepare("INSERT INTO app_meta (key, value) VALUES ('seeded', '1')").run();
  });
}
