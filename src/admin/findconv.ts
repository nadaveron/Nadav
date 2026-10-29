/**
 * חיפוש חופשי בשיחות.
 *
 * חיפוש מילולי מוצא מחרוזת; הוא אינו מוצא נושא. "הורה ששאל למה חוג
 * בבית ספר אחד כלול ואותו חוג בבית ספר אחר אינו כלול" מנוסח אצל כל
 * הורה אחרת, ואין מילה אחת שמשותפת לכולם. לכן הנושא נמסר למודל, שקורא
 * את כל השיחות ומחזיר את המתאימות.
 *
 * הקלט הוא הטקסט המנוקה בלבד - אותה גרסה שנשלחת למודל בשיחה רגילה.
 */
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.ts";
import { log } from "../logger.ts";
import type { ConversationText } from "../store/repo.ts";

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

export interface FoundConversation {
  id: number;
  reason: string;
}

const SYSTEM = `אתה עוזר לנציג של תוכנית עירונית לאתר שיחות בארכיון.

הנציג מתאר במילים שלו נושא, ואתה מקבל את כל השיחות עם הורים. עליך
להחזיר את השיחות שבאמת עוסקות בנושא שתואר.

כללים:
- התאמה לפי משמעות, לא לפי מילים. הורים מנסחים את אותו דבר אחרת.
- אל תכלול שיחה שרק נוגעת בנושא דרך אגב. עדיף להחזיר שלוש שיחות
  מדויקות מאשר עשרים משוערות.
- אם אין התאמה, החזר מערך ריק. זו תשובה לגיטימית.

החזר JSON בלבד, בלי טקסט נוסף, בצורה:
[{"id": 12, "reason": "משפט אחד בעברית - מה בשיחה הזו מתאים"}]`;

/** מסיר עטיפת ``` אם המודל הוסיף אותה בכל זאת. */
function extractJson(raw: string): string {
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(raw);
  const body = fence?.[1] ?? raw;
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

export async function findConversations(
  description: string,
  corpus: ConversationText[],
): Promise<FoundConversation[]> {
  if (corpus.length === 0) return [];

  const transcripts = corpus
    .map((c) => `### שיחה ${c.id}\n${c.text}`)
    .join("\n\n");

  const response = await client.beta.messages.create({
    model: config.anthropic.model,
    max_tokens: 4000,
    // חיפוש הוא משימת סיווג, לא ניסוח. אין צורך בעומק החשיבה של מענה
    // להורה, והחיפוש רץ על כל הארכיון בבת אחת.
    output_config: { effort: "low" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `הנושא שאני מחפש:\n${description}\n\n--- השיחות ---\n\n${transcripts}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("המודל סירב לענות על בקשת החיפוש");
  }

  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(text));
  } catch {
    log.warn("תשובת החיפוש אינה JSON תקין", { sample: text.slice(0, 200) });
    throw new Error("לא הצלחתי לקרוא את תוצאות החיפוש. נסו לנסח אחרת.");
  }
  if (!Array.isArray(parsed)) return [];

  const known = new Set(corpus.map((c) => c.id));
  const out: FoundConversation[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const { id, reason } = item as { id?: unknown; reason?: unknown };
    // מזהה שאינו בארכיון הוא המצאה של המודל, ואין להציג אותו כתוצאה.
    if (typeof id !== "number" || !known.has(id)) continue;
    out.push({ id, reason: typeof reason === "string" ? reason : "" });
  }

  log.info("חיפוש חופשי בשיחות", {
    conversations: corpus.length,
    found: out.length,
    inputTokens: response.usage.input_tokens,
  });
  return out;
}
