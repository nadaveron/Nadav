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
    provider: opt("WHATSAPP_PROVIDER", "meta"),
    phoneNumberId: req("META_PHONE_NUMBER_ID"),
    accessToken: req("META_ACCESS_TOKEN"),
    appSecret: req("META_APP_SECRET"),
    verifyToken: req("META_VERIFY_TOKEN"),
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
  },

  storage: {
    dbPath: opt("DB_PATH", "./data/bot.db"),
    knowledgeDir: opt("KNOWLEDGE_DIR", "./knowledge"),
    rawRetentionDays: num("RAW_RETENTION_DAYS", 180),
  },

  /** כמה תורי שיחה אחרונים נשלחים למודל כהקשר. */
  historyTurns: num("HISTORY_TURNS", 12),
} as const;
