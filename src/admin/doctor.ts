/**
 * בדיקת מוכנות לפני העלייה לאוויר.
 *
 *   npm run doctor
 *
 * עובר על ההגדרות ועל בסיס הידע ומדווח מה מוכן, מה חסר, ומה יגרום
 * לבוט להסלים במקום לענות. מיועד לרוץ לפני כל פריסה.
 */
import fs from "node:fs";
import path from "node:path";
import "dotenv/config";

type Level = "ok" | "warn" | "fail";
const results: { level: Level; area: string; message: string }[] = [];

function add(level: Level, area: string, message: string) {
  results.push({ level, area, message });
}

const env = (n: string) => (process.env[n] ?? "").trim();

// --- Anthropic ------------------------------------------------------------
const key = env("ANTHROPIC_API_KEY");
if (!key) add("fail", "Claude", "חסר ANTHROPIC_API_KEY. הבוט לא יוכל לענות כלל.");
else if (!key.startsWith("sk-ant-"))
  add("warn", "Claude", "ANTHROPIC_API_KEY אינו בפורמט המוכר (sk-ant-...). ודאו שזה מפתח API ולא סיסמה של claude.ai.");
else add("ok", "Claude", `מפתח API קיים. מודל: ${env("CLAUDE_MODEL") || "claude-opus-5"}`);

// --- הצפנה ----------------------------------------------------------------
const encKey = env("DATA_ENCRYPTION_KEY");
if (!encKey) add("fail", "הצפנה", "חסר DATA_ENCRYPTION_KEY. הריצו `npm run keys`.");
else if (Buffer.from(encKey, "base64").length !== 32)
  add("fail", "הצפנה", "DATA_ENCRYPTION_KEY אינו 32 בתים בבסיס 64. הריצו `npm run keys`.");
else add("ok", "הצפנה", "מפתח ההצפנה תקין.");

if (!env("PHONE_HASH_PEPPER")) add("fail", "הצפנה", "חסר PHONE_HASH_PEPPER.");
else add("ok", "הצפנה", "ה-pepper לשמות מדומים קיים.");

// --- ווטסאפ ---------------------------------------------------------------
const provider = env("WHATSAPP_PROVIDER") || "meta";
if (provider === "meta") {
  const missing = ["META_PHONE_NUMBER_ID", "META_ACCESS_TOKEN", "META_APP_SECRET", "META_VERIFY_TOKEN"].filter(
    (n) => !env(n),
  );
  if (missing.length) add("fail", "ווטסאפ", `חסרות הגדרות מטא: ${missing.join(", ")}`);
  else add("ok", "ווטסאפ", `Meta Cloud API מוגדר (${env("META_GRAPH_VERSION") || "v23.0"}).`);
} else {
  add("warn", "ווטסאפ", `הספק הוא "${provider}" ולא מטא. מצב בדיקה בלבד - לא יתקבלו פניות אמיתיות.`);
}

// --- הסלמה לנציג ----------------------------------------------------------
if (!env("MANAGER_PHONE")) {
  add("fail", "הסלמה", "חסר MANAGER_PHONE. הסלמות יישמרו במסד הנתונים אך לא תקבלו התראה.");
} else if (!env("META_ALERT_TEMPLATE")) {
  add(
    "warn",
    "הסלמה",
    "לא הוגדרה תבנית התראה (META_ALERT_TEMPLATE). התראות יישלחו כטקסט חופשי ויעבדו רק אם כתבתם למספר העסקי ב-24 השעות האחרונות. ראו README.",
  );
} else {
  add("ok", "הסלמה", "התראות לנציג דרך תבנית מאושרת - יעבדו בכל שעה.");
}

// --- בסיס הידע ------------------------------------------------------------
const kbDir = env("KNOWLEDGE_DIR") || "./knowledge";
if (!fs.existsSync(kbDir)) {
  add("fail", "בסיס ידע", `התיקייה ${kbDir} לא נמצאה.`);
} else {
  const files = fs.readdirSync(kbDir).filter((f) => f.endsWith(".md")).sort();
  let totalChars = 0;
  const gaps: string[] = [];

  for (const f of files) {
    const body = fs.readFileSync(path.join(kbDir, f), "utf8");
    totalChars += body.length;
    const holes = body.match(/<<<[^>]*>>>/g) ?? [];
    if (holes.length) gaps.push(`${f} (${holes.length})`);
  }

  add("ok", "בסיס ידע", `${files.length} מסמכים, ${totalChars.toLocaleString("he-IL")} תווים.`);
  if (gaps.length) {
    add("warn", "בסיס ידע", `שדות לא מלאים: ${gaps.join(", ")}. בכל אחד מהם הבוט יעביר לנציג במקום לענות.`);
  } else {
    add("ok", "בסיס ידע", "אין שדות לא מלאים.");
  }
}

// --- מסד נתונים -----------------------------------------------------------
const dbPath = env("DB_PATH") || "./data/bot.db";
const dbDir = path.dirname(dbPath);
if (fs.existsSync(dbPath)) {
  const size = fs.statSync(dbPath).size;
  add("ok", "מסד נתונים", `${dbPath} קיים (${(size / 1024).toFixed(0)} KB).`);
} else if (fs.existsSync(dbDir)) {
  add("ok", "מסד נתונים", `${dbPath} ייווצר בהפעלה הראשונה.`);
} else {
  add("warn", "מסד נתונים", `התיקייה ${dbDir} לא קיימת ותיווצר בהפעלה.`);
}
add(
  "warn",
  "מסד נתונים",
  "ודאו שהנתיב הזה יושב על אחסון קבוע ומגובה. בענן, דיסק קונטיינר ארעי נמחק בכל פריסה - יחד עם כל היסטוריית השיחות.",
);

// --- מצב יבש --------------------------------------------------------------
if (["1", "true", "yes"].includes(env("DRY_RUN").toLowerCase())) {
  add("warn", "מצב הרצה", "DRY_RUN פעיל - הבוט מריץ הכול אבל לא שולח תשובות בפועל.");
}

// --- פלט ------------------------------------------------------------------
const icon = { ok: "\x1b[32m✓\x1b[0m", warn: "\x1b[33m!\x1b[0m", fail: "\x1b[31m✗\x1b[0m" };
console.log("\n\x1b[1mבדיקת מוכנות - חוג לכל ילד\x1b[0m\n");
let area = "";
for (const r of results) {
  if (r.area !== area) {
    area = r.area;
    console.log(`\x1b[1m${area}\x1b[0m`);
  }
  console.log(`  ${icon[r.level]} ${r.message}`);
}

const fails = results.filter((r) => r.level === "fail").length;
const warns = results.filter((r) => r.level === "warn").length;
console.log(
  fails
    ? `\n\x1b[31m${fails} חסמים\x1b[0m ו-${warns} אזהרות. הבוט לא יעלה לאוויר עד שהחסמים ייפתרו.\n`
    : `\n\x1b[32mאין חסמים.\x1b[0m ${warns} אזהרות - כדאי לעבור עליהן לפני העלייה.\n`,
);
process.exit(fails ? 1 : 0);
