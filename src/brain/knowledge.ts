import fs from "node:fs";
import path from "node:path";
import { config } from "../config.ts";
import { log } from "../logger.ts";

/**
 * טוען את בסיס הידע מקבצי Markdown.
 *
 * הקבצים נטענים לפי סדר שמם, וסדר קבוע הוא לא קפריזה: תוכן ההנחיה נשלח
 * ל-Claude כקידומת מטמון (prompt cache), וכל שינוי בבתים - כולל סדר קבצים
 * שונה - מבטל את המטמון ומייקר כל פנייה פי עשרה.
 */
let cached: { text: string; loadedAt: Date } | null = null;

export function loadKnowledge(force = false): string {
  if (cached && !force) return cached.text;

  const dir = config.storage.knowledgeDir;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort();

  if (files.length === 0) {
    throw new Error(`לא נמצאו קבצי ידע בתיקייה ${dir}`);
  }

  const sections = files.map((f) => {
    const body = fs.readFileSync(path.join(dir, f), "utf8").trim();
    return `<מסמך שם="${f}">\n${body}\n</מסמך>`;
  });

  const text = sections.join("\n\n");
  cached = { text, loadedAt: new Date() };
  log.info("בסיס הידע נטען", { files: files.length, chars: text.length });
  return text;
}

/** טעינה מחדש בלי הפעלה מחדש של השרת - לאחר עדכון תקנון או שו"ת. */
export function reloadKnowledge(): { files: number; chars: number } {
  const text = loadKnowledge(true);
  return { files: text.split("<מסמך שם=").length - 1, chars: text.length };
}
