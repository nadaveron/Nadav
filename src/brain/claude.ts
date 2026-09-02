import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.ts";
import { log } from "../logger.ts";
import { buildSystemPrompt } from "./prompt.ts";
import { tools, type ToolDecision } from "./tools.ts";
import { assertClean } from "../privacy/redact.ts";
import type { StoredTurn } from "../store/repo.ts";

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

/** תקרת סיבובים בלולאת הכלים. שתי קריאות כלי ברצף זה כבר תרחיש חריג. */
const MAX_ITERATIONS = 4;

export interface BrainResult {
  /** התשובה להורה, עדיין עם סמנים - לפני החזרת הערכים האמיתיים. */
  reply: string;
  decision: ToolDecision;
  usage: { input: number; output: number; cacheRead: number };
  /** true כשהמודל סירב לענות ויש להעביר לנציג. */
  refused: boolean;
}

/**
 * מריץ תור שיחה אחד מול Claude.
 *
 * הקלט חייב להיות מנוקה מזיהוי לפני שהוא מגיע לכאן. assertClean הוא
 * שסתום הביטחון האחרון: אם מזהה שרד את הניקוי, עדיף שהפנייה תיכשל
 * ברעש מאשר שהמספר ייצא החוצה בשקט.
 */
export async function think(history: StoredTurn[], cleanMessage: string): Promise<BrainResult> {
  assertClean(cleanMessage);
  for (const turn of history) assertClean(turn.clean);

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...history.map((t) => ({ role: t.role, content: t.clean }) as Anthropic.Beta.BetaMessageParam),
    { role: "user", content: cleanMessage },
  ];

  const decision: ToolDecision = {};
  const usage = { input: 0, output: 0, cacheRead: 0 };

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await client.beta.messages.create({
      model: config.anthropic.model,
      max_tokens: config.anthropic.maxTokens,
      // רשת ביטחון: אם המודל מסרב לענות מסיבת מדיניות, הבקשה מנותבת
      // אוטומטית למודל חלופי במקום שההורה יקבל שתיקה.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: config.anthropic.effort },
      system: [
        {
          type: "text",
          text: buildSystemPrompt(),
          // בסיס הידע זהה לכל הפונים, ולכן הוא נשמר במטמון משותף.
          // TTL של שעה ולא חמש דקות: בקצב של תוכנית עירונית הפערים בין
          // פניות הם עשרות דקות, ומטמון קצר היה מתקרר בין שיחה לשיחה.
          cache_control: { type: "ephemeral", ttl: "1h" },
        },
      ],
      tools,
      messages,
    });

    usage.input += response.usage.input_tokens ?? 0;
    usage.output += response.usage.output_tokens ?? 0;
    usage.cacheRead += response.usage.cache_read_input_tokens ?? 0;

    if (response.stop_reason === "refusal") {
      log.warn("המודל סירב לענות", {
        category: response.stop_details?.type === "refusal" ? response.stop_details.category : null,
      });
      return { reply: "", decision, usage, refused: true };
    }

    const toolUses = response.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
    );
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    if (toolUses.length === 0) {
      return { reply: text, decision, usage, refused: false };
    }

    // הכלים כאן אינם מביאים מידע חדש - הם מתעדים החלטה. לכן התוצאה היא
    // אישור קבלה, והמודל ממשיך לנסח את התשובה להורה בסיבוב הבא.
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const call of toolUses) {
      const input = call.input as Record<string, string>;
      if (call.name === "refer_to_operator") {
        decision.referral = { operator: input.operator ?? "", topic: input.topic ?? "" };
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content:
            "ההפניה נרשמה. מסור להורה את פרטי הקשר של המפעיל מתוך המסמכים, בקצרה.",
        });
      } else if (call.name === "escalate_to_human") {
        decision.escalation = { reason: input.reason ?? "", summary: input.summary ?? "" };
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: `ההסלמה נרשמה ו${config.handoff.managerName} יקבל התראה. הודע להורה שהפנייה הועברה לנציג, בלי להבטיח זמן מענה מדויק.`,
        });
      } else {
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: "כלי לא מוכר.",
          is_error: true,
        });
      }
    }

    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: results });
  }

  log.warn("נגמרו סיבובי הכלים בלי תשובה סופית");
  return { reply: "", decision, usage, refused: true };
}
