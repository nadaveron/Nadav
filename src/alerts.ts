/**
 * התראות לנציג.
 *
 * העיקרון: הודעה נפרדת על כל הסלמה מציפה את הטלפון ברגע שהתוכנית תופסת
 * תאוצה, ואז מפסיקים להסתכל עליה - וזה גרוע יותר מלא לקבל התראות בכלל.
 * לכן ברירת המחדל היא סיכום מרוכז אחת לכמה שעות, שמגיע רק כשבאמת יש מה
 * לדווח, ומכיל קישור ישיר לכל שיחה. סיבות חמורות עוקפות את הריכוז.
 */
import { config } from "./config.ts";
import { log } from "./logger.ts";
import * as repo from "./store/repo.ts";
import type { WhatsAppProvider } from "./whatsapp/provider.ts";

/** קישור ישיר לשיחה בתיבת הנציג, אם הוגדרה כתובת ציבורית. */
export function conversationLink(id: number): string {
  return config.publicUrl ? `${config.publicUrl}/admin/c/${id}` : "";
}

function isUrgent(reason: string): boolean {
  return config.handoff.urgentReasons.some((r) => reason.includes(r));
}

/**
 * phone הוא null בסיכום המרוכז, שאינו נוגע לפונה יחיד.
 * ref הוא היעד של כפתור הקישור בתבנית: מספר שיחה, או "all" לתיבה כולה.
 */
async function deliver(
  provider: WhatsAppProvider,
  title: string,
  phone: string | null,
  detail: string,
  link: string,
  ref: string,
): Promise<void> {
  const { alertTemplate, alertTemplateLang, managerPhone } = config.handoff;
  if (alertTemplate) {
    // בתבנית הקישור עובר בכפתור ולא כמשתנה בגוף ההודעה - ראו requiredTemplates.
    await provider.sendTemplate(
      managerPhone,
      alertTemplate,
      alertTemplateLang,
      [title, phone ?? "-", detail.slice(0, 600).replace(/\s+/g, " ")],
      ref,
    );
  } else {
    const parts = [`🔔 ${title}`];
    if (phone) parts.push(`טלפון הפונה: ${phone}`);
    parts.push("", detail.slice(0, 700));
    if (link) parts.push("", link);
    await provider.sendText(managerPhone, parts.join("\n"));
  }
}

/**
 * התראת בדיקה לנציג.
 *
 * זה המסלול היחיד שמוכיח שהשרשרת כולה עובדת: שם התבנית, שפתה, פרמטר
 * הכפתור, הטוקן ומספר הנציג. כל אחד מהם נכשל בשקט בייצור, ולכן עדיף
 * לגלות אותו בלחיצה ולא ברגע שהורה ממתין.
 */
export async function sendTestAlert(provider: WhatsAppProvider): Promise<void> {
  const { managerPhone, alertTemplate } = config.handoff;
  if (!managerPhone) throw new Error("לא הוגדר MANAGER_PHONE - אין למי לשלוח");
  await deliver(
    provider,
    "בדיקת מערכת ההתראות",
    null,
    alertTemplate
      ? `ההתראה נשלחה דרך התבנית ${alertTemplate}. אם הגיעה - הצינור עובד.`
      : "לא הוגדרה תבנית התראה, ולכן זו הודעת טקסט חופשי. היא תעבוד רק בתוך 24 שעות מההודעה האחרונה שלך למספר העסקי.",
    config.publicUrl ? `${config.publicUrl}/admin` : "",
    "all",
  );
}

/**
 * מתריע על הסלמה בודדת.
 *
 * במצב "digest" ההודעה אינה נשלחת מיד - היא ממתינה לסיכום הבא, אלא אם
 * הסיבה חמורה. ההסלמה עצמה כבר נשמרה במסד הנתונים לפני הקריאה לכאן,
 * ולכן היא לעולם אינה הולכת לאיבוד גם אם השליחה נכשלת.
 */
export async function notifyManager(
  provider: WhatsAppProvider,
  conversationId: number,
  title: string,
  detail: string,
): Promise<void> {
  const { managerPhone, alertMode } = config.handoff;
  if (!managerPhone || alertMode === "off") return;
  if (alertMode === "digest" && !isUrgent(title)) {
    log.debug("ההתראה תמתין לסיכום המרוכז", { conv: conversationId });
    return;
  }

  try {
    await deliver(
      provider,
      title,
      repo.phoneOf(conversationId) ?? "לא ידוע",
      detail,
      conversationLink(conversationId),
      String(conversationId),
    );
  } catch (err) {
    log.warn("שליחת התראה לנציג נכשלה - ההסלמה נשמרה ותופיע בתיבת הנציג", {
      conv: conversationId,
      error: String(err),
    });
    repo.logEvent(conversationId, "alert_failed", title);
  }
}

/**
 * סיכום מרוכז של כל השיחות שממתינות למענה אנושי.
 * אינו נשלח כשאין מה לדווח - שקט הוא ברירת המחדל.
 */
export async function sendDigest(provider: WhatsAppProvider): Promise<boolean> {
  const { managerPhone, alertMode } = config.handoff;
  if (!managerPhone || alertMode !== "digest") return false;

  const waiting = repo.listConversations(200).filter((c) => c.state === "human");
  if (waiting.length === 0) return false;

  const lines = waiting.slice(0, 10).map((c) => {
    const link = conversationLink(c.id);
    const preview = c.lastMessage.slice(0, 70).replace(/\s+/g, " ");
    return `• ${c.phone} — ${preview}${link ? `\n  ${link}` : ""}`;
  });
  if (waiting.length > 10) lines.push(`ועוד ${waiting.length - 10} שיחות.`);

  const title = `${waiting.length} פניות ממתינות לך`;
  const body = lines.join("\n");
  const inboxLink = config.publicUrl ? `${config.publicUrl}/admin` : "";

  try {
    await deliver(provider, title, null, body, inboxLink, "all");
    log.info("נשלח סיכום מרוכז", { waiting: waiting.length });
    return true;
  } catch (err) {
    log.warn("שליחת הסיכום המרוכז נכשלה", { error: String(err) });
    return false;
  }
}
