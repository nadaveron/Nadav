/**
 * דוחות פנימיים.
 *
 * כל השאילתות כאן רצות על הטקסט המנוקה בלבד, ולכן אפשר להריץ אותן,
 * להעתיק את הפלט ולשלוח אותו הלאה בתוך העירייה בלי לחשוף פרטי תושבים.
 * הפקודה היחידה שנוגעת בתוכן מפוענח היא `conversation`, והיא מיועדת
 * לנציג שמטפל בפנייה ספציפית.
 *
 *   npm run report -- summary
 *   npm run report -- escalations [ימים]
 *   npm run report -- questions [ימים]
 *   npm run report -- cost [ימים]
 *   npm run report -- conversation <מזהה שיחה>
 */
import { db } from "../store/db.ts";
import { decrypt } from "../privacy/crypto.ts";

const [, , command = "summary", arg] = process.argv;
const days = Number(arg) || 30;

function table(rows: Record<string, unknown>[]): void {
  if (rows.length === 0) {
    console.log("(אין נתונים לתקופה שנבחרה)");
    return;
  }
  console.table(rows);
}

switch (command) {
  case "summary": {
    const stats = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM conversations) AS שיחות,
           (SELECT COUNT(*) FROM messages WHERE role='user') AS הודעות_מהורים,
           (SELECT COUNT(*) FROM conversations WHERE state='human') AS בטיפול_נציג,
           (SELECT COUNT(*) FROM events WHERE kind='escalation') AS הסלמות,
           (SELECT COUNT(*) FROM events WHERE kind='referral') AS הפניות_למפעילים,
           (SELECT COUNT(*) FROM events WHERE kind='error') AS תקלות`,
      )
      .get();
    table([stats as Record<string, unknown>]);
    break;
  }

  case "escalations": {
    // הסיבות מלמדות מה חסר בבסיס הידע: סיבה שחוזרת הרבה היא בדרך כלל
    // שאלה שהתקנון או השו"ת לא עונים עליה.
    table(
      db
        .prepare(
          `SELECT detail AS סיבה, COUNT(*) AS כמות
           FROM events
           WHERE kind='escalation' AND created_at > datetime('now', ?)
           GROUP BY detail ORDER BY כמות DESC`,
        )
        .all(`-${days} days`) as Record<string, unknown>[],
    );
    break;
  }

  case "questions": {
    console.log(`\n${days} הימים האחרונים - הודעות פתיחה של הורים:\n`);
    table(
      db
        .prepare(
          `SELECT m.body_clean AS שאלה, m.created_at AS מתי
           FROM messages m
           WHERE m.role='user' AND m.created_at > datetime('now', ?)
             AND m.id = (SELECT MIN(id) FROM messages WHERE conversation_id = m.conversation_id)
           ORDER BY m.id DESC LIMIT 100`,
        )
        .all(`-${days} days`) as Record<string, unknown>[],
    );
    break;
  }

  case "cost": {
    const row = db
      .prepare(
        `SELECT
           COALESCE(SUM(input_tokens),0)  AS טוקני_קלט,
           COALESCE(SUM(cache_read),0)    AS קלט_ממטמון,
           COALESCE(SUM(output_tokens),0) AS טוקני_פלט
         FROM messages WHERE created_at > datetime('now', ?)`,
      )
      .get(`-${days} days`) as Record<string, number>;

    // תעריפי Claude Opus 5, בדולרים למיליון טוקנים. קריאה ממטמון היא כעשירית
    // ממחיר קלט רגיל. עדכנו כאן אם מחליפים מודל.
    const IN = 5, CACHED_IN = 0.5, OUT = 25, USD_ILS = 3.7;
    const usd =
      ((row.טוקני_קלט ?? 0) * IN +
        (row.קלט_ממטמון ?? 0) * CACHED_IN +
        (row.טוקני_פלט ?? 0) * OUT) / 1_000_000;

    table([{ ...row, "עלות_משוערת_$": usd.toFixed(2), "עלות_משוערת_₪": (usd * USD_ILS).toFixed(2) }]);
    console.log("\nהערכה בלבד - החיוב המחייב הוא זה שבקונסולה של Anthropic.\n");
    break;
  }

  case "conversation": {
    const id = Number(arg);
    if (!id) {
      console.error("יש למסור מזהה שיחה: npm run report -- conversation 42");
      process.exit(1);
    }
    const rows = db
      .prepare(
        `SELECT role, body_enc, body_clean, created_at
         FROM messages WHERE conversation_id = ? ORDER BY id`,
      )
      .all(id) as { role: string; body_enc: string | null; body_clean: string; created_at: string }[];

    console.log(`\nשיחה ${id} - ${rows.length} הודעות\n${"=".repeat(50)}`);
    for (const r of rows) {
      // אחרי תקופת השמירה נותר רק הטקסט המנוקה, וזה מכוון.
      const body = r.body_enc ? decrypt(r.body_enc) : `${r.body_clean}  (התוכן הגולמי נמחק)`;
      console.log(`\n[${r.created_at}] ${r.role === "user" ? "הורה" : "בוט"}:\n${body}`);
    }
    console.log();
    break;
  }

  default:
    console.error(`פקודה לא מוכרת: ${command}`);
    console.error("פקודות: summary | escalations | questions | cost | conversation <id>");
    process.exit(1);
}
