/**
 * הרצת מערך שאלות הבדיקה.
 *
 *   npm run eval
 *   npm run eval -- eval/parent-questions.txt --out דוח.md
 *
 * מריץ קובץ שאלות דרך מסלול הייצור המלא, ומפיק מסמך קריא עם השאלה,
 * התשובה, וסימון אם הבוט הסלים. נועד לסקירה אנושית - הקריטריון אינו
 * "התשובה יפה" אלא "האם נאמר משהו שאינו נכון, או הובטח משהו".
 *
 * עולה כסף אמיתי: כל שאלה היא קריאה ל-API.
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.ts";
import { ConsoleProvider } from "../whatsapp/console.ts";
import { handleInbound } from "../handler.ts";
import * as repo from "../store/repo.ts";
import { reloadKnowledge } from "../brain/knowledge.ts";
import { closeDb } from "../store/db.ts";

const args = process.argv.slice(2);
const outFlag = args.indexOf("--out");
const outPath = outFlag >= 0 ? args[outFlag + 1] : undefined;
const file = args.find((a) => !a.startsWith("--") && a !== outPath) ?? "eval/parent-questions.txt";

if (!fs.existsSync(file)) {
  console.error(`קובץ השאלות ${file} לא נמצא.`);
  process.exit(1);
}

/** אוסף את התשובות במקום להדפיס אותן, כדי לבנות מהן דוח. */
class Capture extends ConsoleProvider {
  replies: string[] = [];
  alerts: string[] = [];
  override async sendText(to: string, body: string): Promise<void> {
    if (to === config.handoff.managerPhone) this.alerts.push(body);
    else this.replies.push(body);
  }
  override async sendTemplate(_t: string, _n: string, _l: string, p: string[]): Promise<void> {
    this.alerts.push(p.join(" | "));
  }
}

const provider = new Capture();
const kb = reloadKnowledge();
const lines = fs
  .readFileSync(file, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

const questions = lines.filter((l) => l !== "/חדש").length;
console.log(`מריץ ${questions} שאלות מתוך ${file}`);
console.log(`מודל ${config.anthropic.model}, עומק ${config.anthropic.effort}, ${kb.files} מסמכי ידע\n`);

const report: string[] = [
  `# דוח בדיקת הבוט`,
  ``,
  `נוצר: ${new Date().toLocaleString("he-IL")}`,
  `מודל: ${config.anthropic.model} · עומק: ${config.anthropic.effort} · ידע: ${kb.chars.toLocaleString("he-IL")} תווים`,
  ``,
  `> לסקירה: חפשו תשובה שאינה נכונה, הבטחה שניתנה, או הסלמה שהייתה צריכה לקרות ולא קרתה.`,
  ``,
  `---`,
  ``,
];

let phone = `9725${Date.now().toString().slice(-8)}`;
let n = 0;
let escalations = 0;
const started = Date.now();

for (const line of lines) {
  if (line === "/חדש") {
    phone = `9725${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 9)}`;
    report.push(`### — שיחה חדשה —`, ``);
    continue;
  }

  n++;
  provider.replies = [];
  provider.alerts = [];

  await handleInbound(provider, {
    id: `eval.${Date.now()}.${n}`,
    from: phone,
    profileName: "בדיקה",
    text: line,
    kind: "text",
    timestamp: new Date(),
  });

  const answer = provider.replies.join("\n").trim() || "(לא נשלחה תשובה)";

  // ההסלמה נקבעת ממצב השיחה ולא מהתראה שנשלחה: במצב digest ההתראה
  // ממתינה לסיכום, ולכן ספירה לפי התראות הייתה מחמיצה כמעט הכול.
  const conv = repo.getConversationById(
    repo.getOrCreateConversation(phone).id,
  );
  const escalated = conv?.state === "human";
  if (escalated) {
    escalations++;
    // בייצור הבוט משתיק את עצמו אחרי הסלמה, וזה נכון. בבדיקה זה היה
    // גורם לכל שאר השאלות בבלוק לחזור ריקות, ולכן מחזירים אותו לפעולה.
    repo.returnToBot(conv.id);
  }

  report.push(`**${n}. הורה:** ${line}`, ``, answer, ``);
  if (escalated) report.push(`\`הוסלם לנציג\``, ``);
  report.push(`---`, ``);

  process.stdout.write(`\r  ${n}/${questions}`);
}

const mins = ((Date.now() - started) / 60000).toFixed(1);
report.splice(6, 0, `סה"כ ${n} שאלות · ${escalations} הסלמות · ${mins} דקות`, ``);

const out = outPath ?? path.join("eval", `report-${new Date().toISOString().slice(0, 10)}.md`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, report.join("\n"), "utf8");

console.log(`\n\nהסתיים. ${escalations} הסלמות מתוך ${n} שאלות.`);
console.log(`הדוח נשמר ב-${out}\n`);
closeDb();
