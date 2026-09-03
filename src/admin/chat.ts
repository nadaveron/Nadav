/**
 * ממשק שיחה מקומי לבדיקת הבוט.
 *
 *   npm run chat
 *
 * מדבר עם אותו מנוע שירוץ בייצור - אותה הנחיית מערכת, אותו בסיס ידע,
 * אותה שכבת פרטיות ואותה לוגיקת הסלמה - בלי חיבור לווטסאפ ובלי מטא.
 * מיועד לבדוק את איכות התשובות לפני שהורה אמיתי רואה אותן.
 *
 * פקודות בתוך השיחה:
 *   /חדש     פותח שיחה חדשה עם מספר אחר, כאילו פנה הורה אחר
 *   /מצב     מציג את מצב השיחה הנוכחית ואת מפת המזהים שנוקו
 *   /יציאה   סיום
 */
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { config } from "../config.ts";
import { ConsoleProvider } from "../whatsapp/console.ts";
import { handleInbound } from "../handler.ts";
import * as repo from "../store/repo.ts";
import { reloadKnowledge } from "../brain/knowledge.ts";
import { closeDb } from "../store/db.ts";

const provider = new ConsoleProvider();
const rl = readline.createInterface({ input: stdin, output: stdout });

// מספר מדומה. שינוי המספר פותח שיחה חדשה לגמרי, עם היסטוריה נפרדת.
let phone = "972500000001";
let counter = 0;

const kb = reloadKnowledge();

console.log(`
\x1b[1mחוג לכל ילד - בדיקת הבוט\x1b[0m
מודל: ${config.anthropic.model}  |  עומק חשיבה: ${config.anthropic.effort}
בסיס ידע: ${kb.files} מסמכים, ${kb.chars.toLocaleString("he-IL")} תווים
מסד נתונים: ${config.storage.dbPath}

כתבו הודעה כאילו אתם הורה. /חדש להורה אחר, /מצב למצב השיחה, /יציאה לסיום.
`);

const PROMPT = "\x1b[32m👤 הורה:\x1b[0m ";
rl.setPrompt(PROMPT);
rl.prompt();

// איטרציה על השורות ולא question() בלולאה: כך זה עובד גם אינטראקטיבית
// וגם כשמזרימים קובץ תסריט לבדיקת רגרסיה, בלי ליפול בסוף הקלט.
for await (const raw of rl) {
  const line = raw.trim();
  if (!line) {
    rl.prompt();
    continue;
  }

  if (line === "/יציאה" || line === "/exit") break;

  if (line === "/חדש" || line === "/new") {
    phone = `9725000000${String(Math.floor(Math.random() * 90) + 10)}`;
    console.log(`\n— שיחה חדשה, מספר מדומה ${phone} —\n`);
    rl.prompt();
    continue;
  }

  if (line === "/מצב" || line === "/status") {
    const conv = repo.getOrCreateConversation(phone);
    console.log(`
   מזהה שיחה: ${conv.id}
   מספר מדומה: ${phone}
   מצב: ${conv.state === "human" ? "הועברה לנציג - הבוט שותק" : "הבוט עונה"}
   ${conv.handoffUntil ? `שותק עד: ${conv.handoffUntil}` : ""}
   מזהים שנוקו: ${Object.keys(conv.redactionMap).length === 0 ? "אין" : ""}`);
    for (const [token, value] of Object.entries(conv.redactionMap)) {
      console.log(`     ${token} = ${value}`);
    }
    console.log();
    rl.prompt();
    continue;
  }

  const started = Date.now();
  await handleInbound(provider, {
    id: `local.${Date.now()}.${counter++}`,
    from: phone,
    profileName: "בדיקה",
    text: line,
    kind: "text",
    timestamp: new Date(),
  });
  console.log(`\x1b[90m   (${((Date.now() - started) / 1000).toFixed(1)} שניות)\x1b[0m`);
  rl.prompt();
}

rl.close();
closeDb();
