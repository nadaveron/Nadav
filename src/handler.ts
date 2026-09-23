import { config } from "./config.ts";
import { log } from "./logger.ts";
import { redact, rehydrate } from "./privacy/redact.ts";
import * as repo from "./store/repo.ts";
import { think } from "./brain/claude.ts";
import type { InboundMessage, WhatsAppProvider } from "./whatsapp/provider.ts";
import { notifyManager } from "./alerts.ts";

/** ביטויים שמעבירים לנציג מיד, בלי לשאול את המודל. */
const HUMAN_KEYWORDS = [
  "נציג", "נציגה", "בן אדם", "בנאדם", "אדם אמיתי", "לדבר עם מישהו",
  "אנושי", "מנהל התוכנית", "תפסיק לענות", "בוט מעצבן",
];

/**
 * מה שנאמר להורה כשהמערכת נכשלת טכנית. הנוסח מזמין לנסות שוב, כי התקלה
 * לרוב חולפת והבוט לא מושתק - ואינו מבטיח שמישהו יחזור, כי בתקלה כזו
 * גם ההתראה לנציג עשויה להיכשל.
 */
const FALLBACK_REPLY =
  "סליחה, נתקלתי בתקלה רגעית ולא הצלחתי לענות. " +
  "אפשר לנסות לשלוח את השאלה שוב בעוד כמה דקות, ואם זה חוזר - כתבו 'נציג' " +
  "ואעביר את הפנייה לטיפול.";

const UNSUPPORTED_REPLY =
  "כרגע אני יודע לקרוא רק הודעות טקסט. " +
  "אפשר לכתוב לי את השאלה במילים, ואם צריך אעביר אותך לנציג.";

export async function handleInbound(
  provider: WhatsAppProvider,
  msg: InboundMessage,
): Promise<void> {
  // מטא שולחת כל webhook שוב עד שהיא מקבלת 200. בלי המנעול הזה הורה
  // עלול לקבל את אותה תשובה שלוש פעמים.
  if (!repo.claimMessage(msg.id)) {
    log.debug("הודעה כפולה - דילוג", { waMessageId: msg.id });
    return;
  }

  const conv = repo.getOrCreateConversation(msg.from, msg.profileName);
  // מכאן והלאה מזהים את הפונה רק בשם המדומה, גם בלוגים.
  const ctx = { conv: conv.id, contact: conv.contactHash.slice(0, 8) };

  await provider.markRead(msg.id);

  if (msg.kind !== "text" || msg.text.trim() === "") {
    await reply(provider, conv.id, UNSUPPORTED_REPLY);
    return;
  }

  // ניקוי לפני כל שימוש אחר בטקסט, כדי שגם שמירה ללוג לא תיגע בערך הגולמי.
  const { clean, map, kinds } = redact(msg.text, conv.redactionMap);
  if (kinds.length > 0) {
    repo.saveRedactionMap(conv.id, map);
    log.info("נוקו מזהים אישיים מהודעה נכנסת", { ...ctx, kinds });
  }

  repo.addMessage({
    conversationId: conv.id,
    role: "user",
    raw: msg.text,
    clean,
    waMessageId: msg.id,
  });

  // שיחה שכבר בטיפול אנושי - הבוט מקליט ושותק, כדי לא לדבר מעל הנציג.
  if (repo.isSilenced(conv)) {
    log.info("השיחה בטיפול נציג - הבוט אינו עונה", ctx);
    await notifyManager(provider, conv.id, "הודעה נוספת בשיחה שבטיפולך", clean);
    return;
  }

  // בקשה מפורשת לנציג עוקפת את המודל. הורה שמבקש אדם צריך לקבל אדם,
  // ולא עוד סבב של בוט שמנסה לעזור.
  if (HUMAN_KEYWORDS.some((k) => msg.text.includes(k))) {
    log.info("בקשה מפורשת לנציג", ctx);
    await escalate(provider, conv.id, "בקשה מפורשת לנציג", clean);
    return;
  }

  try {
    const history = repo.recentTurns(conv.id, config.historyTurns).slice(0, -1);
    const result = await think(history, clean);

    log.info("תור שיחה הושלם", {
      ...ctx,
      inputTokens: result.usage.input,
      outputTokens: result.usage.output,
      cacheRead: result.usage.cacheRead,
      escalated: Boolean(result.decision.escalation),
    });

    if (result.decision.referral) {
      repo.logEvent(
        conv.id,
        "referral",
        `${result.decision.referral.operator}: ${result.decision.referral.topic}`,
      );
    }

    if (result.refused || result.reply.trim() === "") {
      await escalate(provider, conv.id, "המודל לא הפיק תשובה", clean);
      return;
    }

    // החזרת הערכים האמיתיים רק ברגע האחרון, לקראת השליחה להורה.
    const text = rehydrate(result.reply, map);
    await reply(provider, conv.id, text, result.usage);

    if (result.decision.escalation) {
      const { reason, summary } = result.decision.escalation;
      repo.setHumanHandoff(conv.id, config.handoff.hours);
      repo.logEvent(conv.id, "escalation", reason);
      await notifyManager(provider, conv.id, `הסלמה: ${reason}`, summary);
    }
  } catch (err) {
    /**
     * תקלה טכנית איננה הסלמה.
     *
     * קודם לכן כל כשל כאן השתיק את הבוט בשיחה ל-24 שעות, כמו העברה
     * לנציג. זה שגוי משתי סיבות: תקלה חולפת - טוקן שפג, שגיאת רשת -
     * הופכת שיחה למתה ליממה שלמה, וההורה נשאר בלי מענה כי גם הודעת
     * ההתנצלות נשלחת באותו ערוץ שנכשל. ובנוסף, בזמן תקלה כלל-מערכתית
     * כל השיחות הפעילות מושתקות בבת אחת.
     *
     * לכן: מתעדים, מנסים להתריע, ומשאירים את השיחה אצל הבוט - כדי
     * שההודעה הבאה תקבל מענה אמיתי ברגע שהתקלה חולפת.
     */
    log.error("כשל בטיפול בפנייה", { ...ctx, error: String(err) });
    repo.logEvent(conv.id, "error", String(err).slice(0, 500));
    try {
      await reply(provider, conv.id, FALLBACK_REPLY);
    } catch {
      log.warn("גם הודעת ההתנצלות לא נשלחה - ככל הנראה תקלה בערוץ עצמו", ctx);
    }
    await notifyManager(provider, conv.id, "תקלה טכנית בטיפול בפנייה", clean);
  }
}

async function reply(
  provider: WhatsAppProvider,
  conversationId: number,
  text: string,
  usage?: { input: number; output: number; cacheRead: number },
): Promise<void> {
  const phone = repo.phoneOf(conversationId);
  if (!phone) {
    log.error("לא נמצא מספר טלפון לשיחה", { conv: conversationId });
    return;
  }
  await provider.sendText(phone, text);

  // חובה לנקות מול המפה של השיחה ולא מול מפה חדשה. אחרת הטלפון של המפעיל
  // שהבוט מסר מקבל את אותו סמן כמו הטלפון של ההורה, ובתור הבא החזרת
  // הערכים הייתה מוסרת להורה את המספר של עצמו במקום את זה של המתנ"ס.
  const conv = repo.getConversationById(conversationId);
  const { clean, map } = redact(text, conv?.redactionMap ?? {});
  repo.saveRedactionMap(conversationId, map);

  repo.addMessage({
    conversationId,
    role: "assistant",
    raw: text,
    clean,
    usage: usage ?? { input: 0, output: 0, cacheRead: 0 },
  });
}

async function escalate(
  provider: WhatsAppProvider,
  conversationId: number,
  reason: string,
  summary: string,
  customReply?: string,
): Promise<void> {
  repo.setHumanHandoff(conversationId, config.handoff.hours);
  repo.logEvent(conversationId, "escalation", reason);
  await reply(provider, conversationId, customReply ?? config.handoff.message);
  await notifyManager(provider, conversationId, `הסלמה: ${reason}`, summary);
}
