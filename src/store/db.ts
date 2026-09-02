import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.ts";

/**
 * SQLite מקומי. בנפח שהתוכנית מייצרת (אלפי הודעות בשנה) זה מהיר בהרבה
 * ממסד מנוהל, וחשוב מכך - הוא קובץ אחד שאפשר לגבות, להעביר ולהצפין.
 * כל שדה שמכיל מידע אישי מוצפן בשכבת האפליקציה לפני שהוא מגיע לכאן,
 * כך שגם ספק האחסון או מי שמשיג עותק של הקובץ אינו רואה תוכן.
 */
const dir = path.dirname(config.storage.dbPath);
fs.mkdirSync(dir, { recursive: true });

export const db = new Database(config.storage.dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS conversations (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_hash       TEXT NOT NULL UNIQUE,
  phone_enc          TEXT NOT NULL,
  display_name_enc   TEXT,
  state              TEXT NOT NULL DEFAULT 'bot',
  handoff_until      TEXT,
  redaction_map_enc  TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id  INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role             TEXT NOT NULL,
  body_enc         TEXT,
  body_clean       TEXT NOT NULL,
  wa_message_id    TEXT,
  input_tokens     INTEGER DEFAULT 0,
  output_tokens    INTEGER DEFAULT 0,
  cache_read       INTEGER DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, id);

CREATE TABLE IF NOT EXISTS events (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id  INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL,
  detail           TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind, created_at);

-- מטא מונע טיפול כפול: מטא שולחת webhook מחדש עד שהיא מקבלת 200,
-- ובלי זה הורה היה מקבל את אותה תשובה כמה פעמים.
CREATE TABLE IF NOT EXISTS processed_messages (
  wa_message_id  TEXT PRIMARY KEY,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

export function closeDb(): void {
  db.close();
}
