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

/** שולף שיחה קיימת לפי מזהה, כולל מפת הסמנים שלה. */
export function getConversationById(id: number): Conversation | null {
  const row = db
    .prepare(
      `SELECT id, contact_hash, state, handoff_until, redaction_map_enc
       FROM conversations WHERE id = ?`,
    )
    .get(id) as ConvRow | undefined;
  return row ? toConversation(row) : null;
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
  role: "user" | "assistant" | "human";
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
  return rows.reverse().map((r) => ({
    // הודעה שנציג כתב נשמרת בתפקיד "human" כדי שהתמלול ישקף מי ענה,
    // אך מול ה-API היא חייבת להיראות כתשובת עוזר - אין תפקיד כזה בפרוטוקול.
    role: r.role === "user" ? "user" : "assistant",
    clean: r.body_clean,
  }));
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


// ===========================================================================
//  תיבת הנציג
// ===========================================================================

export interface InboxRow {
  id: number;
  phone: string;
  state: "bot" | "human";
  updatedAt: string;
  messages: number;
  lastMessage: string;
  lastRole: string;
}

/** רשימת השיחות לתיבת הנציג, החדשה ביותר ראשונה. */
export function listConversations(limit = 100): InboxRow[] {
  const rows = db
    .prepare(
      `SELECT c.id, c.phone_enc, c.state, c.updated_at,
              (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS messages,
              (SELECT m.body_clean FROM messages m
                WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_message,
              (SELECT m.role FROM messages m
                WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_role
       FROM conversations c
       ORDER BY c.updated_at DESC
       LIMIT ?`,
    )
    .all(limit) as {
    id: number;
    phone_enc: string;
    state: string;
    updated_at: string;
    messages: number;
    last_message: string | null;
    last_role: string | null;
  }[];

  return rows.map((r) => ({
    id: r.id,
    phone: decrypt(r.phone_enc),
    state: r.state === "human" ? "human" : "bot",
    updatedAt: r.updated_at,
    messages: r.messages,
    lastMessage: r.last_message ?? "",
    lastRole: r.last_role ?? "",
  }));
}

export interface TranscriptLine {
  role: string;
  body: string;
  /** true כשהתוכן הגולמי כבר נמחק ונותר רק הטקסט המנוקה. */
  redactedOnly: boolean;
  at: string;
}

/** תמלול מלא ומפוענח של שיחה - לשימוש הנציג בלבד. */
export function transcript(conversationId: number): TranscriptLine[] {
  const rows = db
    .prepare(
      `SELECT role, body_enc, body_clean, created_at
       FROM messages WHERE conversation_id = ? ORDER BY id`,
    )
    .all(conversationId) as {
    role: string;
    body_enc: string | null;
    body_clean: string;
    created_at: string;
  }[];

  return rows.map((r) => ({
    role: r.role,
    body: r.body_enc ? decrypt(r.body_enc) : r.body_clean,
    redactedOnly: !r.body_enc,
    at: r.created_at,
  }));
}

export interface SearchHit {
  id: number;
  phone: string;
  state: "bot" | "human";
  updatedAt: string;
  /** השורות שהתאימו, עם התפקיד שכתב אותן. */
  matches: { role: string; body: string; at: string }[];
}

/**
 * חיפוש טקסט בכל השיחות.
 *
 * החיפוש נעשה על הטקסט המנוקה (body_clean), שאינו מוצפן - ולכן הוא מהיר
 * ואינו דורש לפענח את כל המסד. המשמעות היא שמספרים ושמות שנוקו אינם
 * ניתנים לחיפוש, וזה מכוון.
 *
 * זה הכלי שמאתר שיחות שבהן נמסר מידע שהתברר כשגוי - למשל אחרי תיקון
 * בבסיס הידע, כשצריך לחזור להורים שקיבלו את התשובה הישנה.
 */
export function searchConversations(
  term: string,
  opts: { botOnly?: boolean; limit?: number } = {},
): SearchHit[] {
  const clean = term.trim();
  if (!clean) return [];
  // תווי הג'וקר של LIKE חייבים בריחה, אחרת חיפוש של "%" סורק הכול.
  const pattern = `%${clean.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

  const rows = db
    .prepare(
      `SELECT m.conversation_id AS cid, m.role, m.body_clean, m.created_at
       FROM messages m
       WHERE m.body_clean LIKE ? ESCAPE '\\'
         ${opts.botOnly ? "AND m.role <> 'user'" : ""}
       ORDER BY m.id`,
    )
    .all(pattern) as {
    cid: number;
    role: string;
    body_clean: string;
    created_at: string;
  }[];

  const byConv = new Map<number, { role: string; body: string; at: string }[]>();
  for (const r of rows) {
    const list = byConv.get(r.cid) ?? [];
    list.push({ role: r.role, body: r.body_clean, at: r.created_at });
    byConv.set(r.cid, list);
  }

  const out: SearchHit[] = [];
  for (const [cid, matches] of byConv) {
    const conv = db
      .prepare(
        `SELECT id, phone_enc, state, updated_at FROM conversations WHERE id = ?`,
      )
      .get(cid) as
      | { id: number; phone_enc: string; state: string; updated_at: string }
      | undefined;
    if (!conv) continue;
    out.push({
      id: conv.id,
      phone: decrypt(conv.phone_enc),
      state: conv.state === "human" ? "human" : "bot",
      updatedAt: conv.updated_at,
      matches,
    });
  }
  out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return out.slice(0, opts.limit ?? 200);
}

export interface ErrorEvent {
  conversationId: number | null;
  detail: string;
  at: string;
}

/**
 * התקלות האחרונות, להצגה בתיבת הנציג.
 *
 * כשהבוט מחזיר להורים את הודעת ההתנצלות, הסיבה האמיתית יושבת ביומן של
 * שרת האירוח - מקום שהנציג אינו נכנס אליו ואינו אמור להיכנס אליו. בלי
 * התצוגה הזו, "הבוט לא עונה" הוא דיווח בלי שום דרך לפעול לפיו.
 */
export function recentErrors(limit = 10): ErrorEvent[] {
  const rows = db
    .prepare(
      `SELECT conversation_id, detail, created_at
       FROM events WHERE kind = 'error'
       ORDER BY id DESC LIMIT ?`,
    )
    .all(limit) as {
    conversation_id: number | null;
    detail: string | null;
    at?: string;
    created_at: string;
  }[];
  return rows.map((r) => ({
    conversationId: r.conversation_id,
    detail: r.detail ?? "",
    at: r.created_at,
  }));
}

/** כמה תקלות נרשמו בשעות האחרונות - כדי להבחין בין תקלה בודדת לתקלה מתמשכת. */
export function errorCountSince(hours: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM events
       WHERE kind = 'error' AND created_at > datetime('now', ?)`,
    )
    .get(`-${hours} hours`) as { n: number };
  return row.n;
}
