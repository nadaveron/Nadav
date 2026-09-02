import { db } from "./db.ts";
import { encrypt, decrypt, pseudonym } from "../privacy/crypto.ts";
import type { RedactionMap } from "../privacy/redact.ts";
import { config } from "../config.ts";

export interface Conversation {
  id: number;
  contactHash: string;
  state: "bot" | "human";
  handoffUntil: string | null;
  redactionMap: RedactionMap;
}

export interface StoredTurn {
  role: "user" | "assistant";
  /** תמיד הגרסה המנוקה - זו הגרסה היחידה שנשלחת חזרה למודל. */
  clean: string;
}

interface ConvRow {
  id: number;
  contact_hash: string;
  state: string;
  handoff_until: string | null;
  redaction_map_enc: string | null;
}

/** מאתר או פותח שיחה. מספר הטלפון נשמר מוצפן; המפתח לחיפוש הוא ה-hash. */
export function getOrCreateConversation(phone: string, displayName?: string): Conversation {
  const hash = pseudonym(phone);
  const existing = db
    .prepare(
      `SELECT id, contact_hash, state, handoff_until, redaction_map_enc
       FROM conversations WHERE contact_hash = ?`,
    )
    .get(hash) as ConvRow | undefined;

  if (existing) return toConversation(existing);

  const info = db
    .prepare(
      `INSERT INTO conversations (contact_hash, phone_enc, display_name_enc)
       VALUES (?, ?, ?)`,
    )
    .run(hash, encrypt(phone), displayName ? encrypt(displayName) : null);

  return {
    id: Number(info.lastInsertRowid),
    contactHash: hash,
    state: "bot",
    handoffUntil: null,
    redactionMap: {},
  };
}

function toConversation(row: ConvRow): Conversation {
  return {
    id: row.id,
    contactHash: row.contact_hash,
    state: row.state === "human" ? "human" : "bot",
    handoffUntil: row.handoff_until,
    redactionMap: row.redaction_map_enc
      ? (JSON.parse(decrypt(row.redaction_map_enc)) as RedactionMap)
      : {},
  };
}

export function saveRedactionMap(conversationId: number, map: RedactionMap): void {
  db.prepare(
    `UPDATE conversations
     SET redaction_map_enc = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(Object.keys(map).length ? encrypt(JSON.stringify(map)) : null, conversationId);
}

/** מעביר שיחה לטיפול אנושי ומשתיק את הבוט לפרק הזמן שהוגדר. */
export function setHumanHandoff(conversationId: number, hours: number): void {
  db.prepare(
    `UPDATE conversations
     SET state = 'human',
         handoff_until = datetime('now', ?),
         updated_at = datetime('now')
     WHERE id = ?`,
  ).run(`+${hours} hours`, conversationId);
}

export function returnToBot(conversationId: number): void {
  db.prepare(
    `UPDATE conversations
     SET state = 'bot', handoff_until = NULL, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(conversationId);
}

/** האם הבוט אמור לשתוק עכשיו. פג תוקף ההשתקה מחזיר אותו לפעולה מעצמו. */
export function isSilenced(conv: Conversation): boolean {
  if (conv.state !== "human") return false;
  if (!conv.handoffUntil) return true;
  const stillHeld = db
    .prepare(`SELECT datetime('now') < ? AS held`)
    .get(conv.handoffUntil) as { held: number };
  if (stillHeld.held) return true;
  returnToBot(conv.id);
  return false;
}

export function addMessage(args: {
  conversationId: number;
  role: "user" | "assistant";
  raw: string;
  clean: string;
  waMessageId?: string;
  usage?: { input: number; output: number; cacheRead: number };
}): void {
  db.prepare(
    `INSERT INTO messages
       (conversation_id, role, body_enc, body_clean, wa_message_id,
        input_tokens, output_tokens, cache_read)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    args.conversationId,
    args.role,
    encrypt(args.raw),
    args.clean,
    args.waMessageId ?? null,
    args.usage?.input ?? 0,
    args.usage?.output ?? 0,
    args.usage?.cacheRead ?? 0,
  );
  db.prepare(`UPDATE conversations SET updated_at = datetime('now') WHERE id = ?`).run(
    args.conversationId,
  );
}

/** מחזיר את סוף השיחה כהקשר למודל - תמיד בגרסה המנוקה. */
export function recentTurns(conversationId: number, limit: number): StoredTurn[] {
  const rows = db
    .prepare(
      `SELECT role, body_clean FROM messages
       WHERE conversation_id = ? ORDER BY id DESC LIMIT ?`,
    )
    .all(conversationId, limit) as { role: string; body_clean: string }[];
  return rows
    .reverse()
    .map((r) => ({ role: r.role as "user" | "assistant", clean: r.body_clean }));
}

/** מחזיר את מספר הטלפון המפוענח - לשימוש בשליחת התשובה בלבד. */
export function phoneOf(conversationId: number): string | null {
  const row = db
    .prepare(`SELECT phone_enc FROM conversations WHERE id = ?`)
    .get(conversationId) as { phone_enc: string } | undefined;
  return row ? decrypt(row.phone_enc) : null;
}

export function logEvent(
  conversationId: number | null,
  kind: string,
  detail?: string,
): void {
  db.prepare(`INSERT INTO events (conversation_id, kind, detail) VALUES (?, ?, ?)`).run(
    conversationId,
    kind,
    detail ?? null,
  );
}

/** אמת אם ההודעה כבר טופלה. מחזיר true בפעם הראשונה בלבד. */
export function claimMessage(waMessageId: string): boolean {
  try {
    db.prepare(`INSERT INTO processed_messages (wa_message_id) VALUES (?)`).run(waMessageId);
    return true;
  } catch {
    return false;
  }
}

/**
 * מוחק את התוכן הגולמי המוצפן אחרי תקופת השמירה, ומשאיר את הטקסט המנוקה
 * לצורך ניתוח פנימי. כך היסטוריית התובנות נשמרת בלי להחזיק מידע אישי לנצח.
 */
export function purgeExpiredRawContent(): number {
  const days = config.storage.rawRetentionDays;
  if (days <= 0) return 0;
  const res = db
    .prepare(
      `UPDATE messages SET body_enc = NULL
       WHERE body_enc IS NOT NULL AND created_at < datetime('now', ?)`,
    )
    .run(`-${days} days`);
  db.prepare(
    `UPDATE conversations SET redaction_map_enc = NULL
     WHERE redaction_map_enc IS NOT NULL AND updated_at < datetime('now', ?)`,
  ).run(`-${days} days`);
  db.prepare(`DELETE FROM processed_messages WHERE created_at < datetime('now', '-30 days')`).run();
  return res.changes;
}
