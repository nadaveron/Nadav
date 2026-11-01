/**
 * איחוד הודעות רצופות לתור שיחה אחד.
 *
 * בווטסאפ אנשים כותבים בפרצים: "היי, לא מצליח לקנות" ואחריה מיד "זה
 * נתקע". אלה שתי הודעות נפרדות, כל אחת עם מזהה משלה, ולכן מנגנון מניעת
 * הכפילות - שמזהה הודעה שכבר טופלה - אינו רואה כאן שום כפילות. התוצאה
 * היא שתי תשובות לאותה שאלה, שנוסחו בנפרד ולכן גם שונות זו מזו.
 *
 * הפתרון: אחרי כל הודעה ממתינים רגע. אם בינתיים הגיעה הודעה נוספת
 * מאותה שיחה, ההודעה הקודמת מוותרת על התור - ההודעה האחרונה תענה על
 * כולן יחד, כשההיסטוריה כבר מכילה את שתיהן.
 */

/** ההודעה האחרונה שנראתה בכל שיחה. */
const latest = new Map<number, string>();

/** התור הרץ בכל שיחה, כדי ששני תורים לא ירוצו בחפיפה ויענו מעל זה לזה. */
const running = new Map<number, Promise<void>>();

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function markLatest(conversationId: number, messageId: string): void {
  latest.set(conversationId, messageId);
}

export function isLatest(conversationId: number, messageId: string): boolean {
  return latest.get(conversationId) === messageId;
}

/**
 * ממתין לשקט בשיחה. מחזיר true אם ההודעה הזו עדיין האחרונה ויש לענות
 * עליה, ו-false אם הגיעה אחריה הודעה חדשה שתענה במקומה.
 */
export async function waitForQuiet(
  conversationId: number,
  messageId: string,
  ms: number,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<boolean> {
  markLatest(conversationId, messageId);
  if (ms > 0) await wait(ms);
  return isLatest(conversationId, messageId);
}

/**
 * מריץ תורים של אותה שיחה בזה אחר זה.
 *
 * בלי זה, הודעה שהגיעה בזמן שהמודל עוד חושב על הקודמת הייתה מייצרת
 * שתי שליחות במקביל - ובסדר שאינו מובטח.
 */
export async function runExclusive(
  conversationId: number,
  task: () => Promise<void>,
): Promise<void> {
  const ahead = running.get(conversationId) ?? Promise.resolve();
  let release!: () => void;
  const mine = ahead.then(() => new Promise<void>((r) => (release = r)));
  running.set(conversationId, mine);

  await ahead;
  try {
    await task();
  } finally {
    release();
    // מנקים רק אם לא נכנס תור נוסף אחרינו, אחרת נמחק את השרשרת החיה.
    if (running.get(conversationId) === mine) running.delete(conversationId);
  }
}

/** לבדיקות בלבד. */
export function resetCoalesceState(): void {
  latest.clear();
  running.clear();
}
