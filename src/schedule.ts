/**
 * מתי לשלוח את הסיכום המרוכז.
 *
 * עד עכשיו הסיכום נשלח כל N שעות, וזה ייצר הודעות בשעות שבהן אף אחד לא
 * מסתכל - כולל אמצע הלילה וסופי שבוע. במקום זה נקבעות שעות קבועות בימים
 * קבועים.
 *
 * כל החישוב נעשה בשעון ישראל דרך Intl, ולכן מעבר שעון קיץ מטופל מעצמו
 * ואין כאן חישוב היסט ידני.
 */

/** 0 = ראשון, 6 = שבת - כמו getDay של JavaScript. */
const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export interface LocalNow {
  /** YYYY-MM-DD בשעון המקומי. */
  date: string;
  minutes: number;
  dayOfWeek: number;
}

export function localNow(now: Date, timeZone: string): LocalNow {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  }).formatToParts(now);

  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "";

  // ב-en-GB חצות מוצגת לעתים כ-24 ולא כ-00.
  const hour = Number(get("hour")) % 24;
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: hour * 60 + Number(get("minute")),
    dayOfWeek: WEEKDAY_INDEX[get("weekday")] ?? 0,
  };
}

/** "07:30" -> 450. מחרוזת שאינה תקינה נזרקת בעלייה ולא בזמן ריצה. */
export function parseTime(value: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) throw new Error(`שעה לא תקינה בהגדרת DIGEST_TIMES: "${value}"`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error(`שעה לא תקינה בהגדרת DIGEST_TIMES: "${value}"`);
  return h * 60 + min;
}

export function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * כמה דקות אחרי השעה הנקובה עדיין שולחים. חלון ולא רגע מדויק, כי הטיימר
 * מתעורר פעם בדקה ועשוי לפספס; חלון קצר מונע מהפעלה מחדש בצהריים לשלוח
 * את הסיכום של הבוקר.
 */
export const GRACE_MINUTES = 10;

/**
 * מחזיר את מפתח המשבצת שיש לשלוח עכשיו, או null. המפתח ייחודי ליום
 * ולשעה, כדי שהקורא יוכל לוודא שלא שלח אותה פעמיים.
 */
export function dueSlot(
  now: Date,
  opts: { timeZone: string; times: number[]; days: number[] },
): string | null {
  const local = localNow(now, opts.timeZone);
  if (!opts.days.includes(local.dayOfWeek)) return null;
  for (const t of opts.times) {
    const late = local.minutes - t;
    if (late >= 0 && late <= GRACE_MINUTES) return `${local.date} ${formatTime(t)}`;
  }
  return null;
}

/**
 * תאריך ושעה כפי שהם נשמרים ב-SQLite: "YYYY-MM-DD HH:MM:SS" ב-UTC,
 * בלי סימון אזור זמן. הצגה שלהם כמו שהם מראה לנציג שעה שאינה השעה שבה
 * ההודעה נשלחה - פער של שעתיים או שלוש, תלוי בשעון קיץ.
 */
export function formatLocalTimestamp(
  stored: string,
  timeZone: string,
  now: Date = new Date(),
): string {
  const parsed = new Date(`${stored.trim().replace(" ", "T")}Z`);
  if (Number.isNaN(parsed.getTime())) return stored;

  const then = localNow(parsed, timeZone);
  const today = localNow(now, timeZone);
  const clock = formatTime(then.minutes);

  if (then.date === today.date) return `היום ${clock}`;

  const yesterday = localNow(new Date(now.getTime() - 24 * 60 * 60 * 1000), timeZone);
  if (then.date === yesterday.date) return `אתמול ${clock}`;

  const [y, m, d] = then.date.split("-");
  return `${d}.${m}.${y} ${clock}`;
}
