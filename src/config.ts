import "dotenv/config";

function req(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(
      `חסרה הגדרת סביבה חובה: ${name}. ראו .env.example והשלימו את הקובץ .env`,
    );
  }
  return v.trim();
}

function opt(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : fallback;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v || v.trim() === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`הגדרת הסביבה ${name} אינה מספר תקין`);
  return n;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (!v) return fallback;
  return ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
}

const whatsappProvider = opt("WHATSAPP_PROVIDER", "meta");

/**
 * מנרמל כתובת שירות לצורה שאפשר ללחוץ עליה.
 * חלק מספקי האירוח מספקים רק שם מארח בלי סכימה, ולפעמים עם פורט 443
 * מפורש - שני אלה מייצרים קישור שבור בהודעת ווטסאפ.
 */
function normalizeUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, "");
  if (!url) return "";
  url = url.replace(/:443$/, "");
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url;
}

/** נדרש רק כשעובדים מול מטא בפועל; במצב בדיקה מקומית מחזיר מחרוזת ריקה. */
function metaRequired(name: string): string {
  return whatsappProvider === "meta" ? req(name) : opt(name, "");
}

/**
 * כל ההגדרות נקראות פעם אחת בעלייה. אם חסר משהו קריטי - התהליך נופל מיד,
 * ולא מגלה את זה רק כשהורה ראשון שולח הודעה.
 */
export const config = {
  port: num("PORT", 3000),
  logLevel: opt("LOG_LEVEL", "info"),
  dryRun: bool("DRY_RUN", false),

  anthropic: {
    apiKey: req("ANTHROPIC_API_KEY"),
    model: opt("CLAUDE_MODEL", "claude-opus-5"),
    effort: opt("CLAUDE_EFFORT", "medium") as
      | "low"
      | "medium"
      | "high"
      | "xhigh"
      | "max",
    maxTokens: num("CLAUDE_MAX_TOKENS", 16000),
  },

  whatsapp: {
    provider: whatsappProvider,
    // הגדרות מטא נדרשות רק כשהספק הוא מטא. במצב בדיקה מקומית
    // (WHATSAPP_PROVIDER=console) אפשר להריץ את הבוט עם מפתח Anthropic בלבד.
    phoneNumberId: metaRequired("META_PHONE_NUMBER_ID"),
    accessToken: metaRequired("META_ACCESS_TOKEN"),
    appSecret: metaRequired("META_APP_SECRET"),
    verifyToken: metaRequired("META_VERIFY_TOKEN"),
    graphVersion: opt("META_GRAPH_VERSION", "v23.0"),
  },

  crypto: {
    encryptionKey: req("DATA_ENCRYPTION_KEY"),
    phonePepper: req("PHONE_HASH_PEPPER"),
  },

  handoff: {
    managerPhone: opt("MANAGER_PHONE", ""),
    managerName: opt("MANAGER_NAME", "נציג התוכנית"),
    hours: num("HUMAN_HANDOFF_HOURS", 24),
    /**
     * שם תבנית מאושרת במטא להתראות לנציג. בלעדיה ההתראה נשלחת כטקסט
     * חופשי, ותיכשל אם הנציג לא כתב למספר העסקי ב-24 השעות האחרונות.
     */
    alertTemplate: opt("META_ALERT_TEMPLATE", ""),
    alertTemplateLang: opt("META_ALERT_TEMPLATE_LANG", "he"),
    /**
     * מה שנאמר להורה בהעברה לנציג.
     *
     * הניסוח נמנע במכוון מ"נחזור אליך בהקדם": המענה האנושי כאן אינו יומי,
     * והבטחה שלא תתקיים מייצרת פנייה חוזרת כועסת במקום סבלנות. עדיף
     * לומר את האמת ולהציע ערוץ מהיר יותר למי שממהר.
     */
    /**
     * מדיניות ההתראות.
     *
     * "digest" (ברירת מחדל): הודעה מרוכזת אחת כל כמה שעות, עם רשימת כל
     * מה שממתין. זה מה שמונע הצפה כשמגיעות עשרות פניות.
     * "immediate": הודעה נפרדת על כל הסלמה.
     * "off": בלי התראות. הכול עדיין נשמר ומופיע בתיבת הנציג.
     *
     * בכל מצב, סיבות חמורות עוקפות את הריכוז ומתריעות מיד - ראו urgentReasons.
     */
    alertMode: opt("ALERT_MODE", "digest") as "digest" | "immediate" | "off",
    digestHours: num("DIGEST_HOURS", 4),
    /**
     * סיבות שלא ממתינות לסיכום. אלה מקרים שבהם עיכוב של שעות הוא עצמו
     * הנזק, ולכן הם מתריעים מיד גם במצב "digest".
     */
    urgentReasons: opt("URGENT_REASONS", "מצוקה אישית,תלונה או חוסר שביעות רצון")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    message: opt(
      "HANDOFF_MESSAGE",
      "רשמתי את הפנייה והעברתי אותה למנהל התוכנית. " +
        "המענה יגיע אליך תוך שני ימי עסקים. " +
        "אם העניין דחוף יותר, שאלות על החוג עצמו - מקום פנוי, שעות, תשלום - " +
        "נענות מהר יותר ישירות אצל הגוף המפעיל, ואשמח למסור לך את הטלפון שלו. " +
        "בינתיים אני כאן לכל שאלה נוספת.",
    ),
  },

  /**
   * תיבת הנציג. נסגרת כברירת מחדל: בלי ADMIN_PASSWORD הנתיב /admin כלל
   * אינו נרשם, כדי שתקלת הגדרה לא תחשוף תמלולי שיחות של תושבים.
   */
  inbox: {
    password: opt("ADMIN_PASSWORD", ""),
    get enabled(): boolean {
      return opt("ADMIN_PASSWORD", "").length >= 16;
    },
  },

  /**
   * הכתובת הציבורית של השירות, לבניית קישורים ישירים בהתראות.
   *
   * Render מזריק RENDER_EXTERNAL_URL אוטומטית, ולכן אין צורך להגדיר ידנית
   * שם. PUBLIC_URL גובר עליו, למקרה של דומיין מותאם.
   */
  publicUrl: normalizeUrl(opt("PUBLIC_URL", "") || opt("RENDER_EXTERNAL_URL", "")),

  storage: {
    dbPath: opt("DB_PATH", "./data/bot.db"),
    knowledgeDir: opt("KNOWLEDGE_DIR", "./knowledge"),
    rawRetentionDays: num("RAW_RETENTION_DAYS", 180),
  },

  /** כמה תורי שיחה אחרונים נשלחים למודל כהקשר. */
  historyTurns: num("HISTORY_TURNS", 12),
} as const;
