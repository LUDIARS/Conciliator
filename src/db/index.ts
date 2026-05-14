import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { logger } from "../shared/logger.js";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.js";

export type DB = Database.Database;

let db: DB | null = null;

/** conciliator.db を開き、スキーマを適用する (冪等)。 */
export function openDb(dbPath = resolve("data/conciliator.db")): DB {
  if (db) return db;

  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const conn = new Database(dbPath);
  conn.pragma("journal_mode = WAL");
  conn.pragma("foreign_keys = ON");
  conn.exec(SCHEMA_SQL);
  migrate(conn);

  conn
    .prepare(
      `INSERT INTO schema_meta (key, value) VALUES ('version', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(String(SCHEMA_VERSION));

  logger.info({ dbPath, schemaVersion: SCHEMA_VERSION }, "database opened");
  db = conn;
  return conn;
}

/** 既存 DB を現行スキーマへ追従させる (CREATE IF NOT EXISTS で拾えない列追加など)。 */
function migrate(conn: DB): void {
  const cols = conn.prepare("PRAGMA table_info(workers)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "cernere_user_id")) {
    conn.exec("ALTER TABLE workers ADD COLUMN cernere_user_id TEXT");
    logger.info("migrated: workers.cernere_user_id added");
  }
}

export function getDb(): DB {
  if (!db) throw new Error("DB not initialized — call openDb() first");
  return db;
}

export function closeDb(): void {
  db?.close();
  db = null;
}
