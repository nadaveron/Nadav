/**
 * שכבת ניקוי מזהים אישיים.
 *
 * זהו הרכיב היחיד שעומד בין ההודעה של ההורה לבין ה-API של Anthropic.
 * הכלל: שום מזהה אישי לא עוזב את השרת של העירייה. במקומו נשלח סמן
 * ([[ID_1]] וכדומה), והטבלה שממפה סמן לערך האמיתי נשמרת מוצפנת מקומית.
 *
 * בדרך חזרה, כשהמודל מזכיר סמן בתשובה, אנחנו מחליפים אותו בערך האמיתי -
 * כך שההורה רואה תשובה טבעית עם השם או המספר שלו, והמודל מעולם לא ראה אותם.
 */

export type PiiKind = "ID" | "PHONE" | "EMAIL" | "CARD" | "NAME" | "ADDR" | "NUM";

export interface RedactionMap {
  /** סמן -> הערך המקורי. לדוגמה "[[ID_1]]" -> "312345678" */
  [token: string]: string;
}

export interface RedactionResult {
  /** הטקסט הבטוח לשליחה החוצה. */
  clean: string;
  /** המיפוי חזרה. נשמר מוצפן, לעולם לא נשלח החוצה. */
  map: RedactionMap;
  /** אילו סוגי מזהים נמצאו - נשמר כמטא-דאטה לצורך ביקורת. */
  kinds: PiiKind[];
}

/** ספרת ביקורת של תעודת זהות ישראלית. */
export function isValidIsraeliId(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 5 || digits.length > 9) return false;
  const padded = digits.padStart(9, "0");
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = Number(padded[i]) * ((i % 2) + 1);
    if (d > 9) d -= 9;
    sum += d;
  }
  return sum % 10 === 0;
}

/**
 * הסדר כאן משמעותי: תבניות ספציפיות קודם, כלליות אחר כך, אחרת דפוס רחב
 * "בולע" מזהה מדויק יותר (למשל רצף ספרות שהוא בעצם מספר טלפון).
 */
interface Rule {
  kind: PiiKind;
  pattern: RegExp;
  /** בדיקה נוספת - מאפשרת לדחות התאמות שגויות בלי לסבך את הביטוי הרגולרי. */
  accept?: (match: string) => boolean;
  /** מצמצם התאמה רחבה מדי. החזרת null מבטלת אותה לגמרי. */
  refine?: (match: string) => string | null;
}

/**
 * מילים שמופיעות בעברית מיד אחרי "הבן שלי" או "קוראים לי" ואינן שם.
 * בלעדיהן הדפוס בולע חצי משפט ומנקה טקסט תמים כמו "הבן שלי בכיתה ב".
 */
const NAME_STOPWORDS = new Set([
  "אני", "ואני", "אנחנו", "ואנחנו", "הוא", "היא", "זה", "זו", "לא", "כן",
  "רוצה", "רוצים", "צריך", "צריכה", "אמור", "אמורה", "מתחיל", "מתחילה",
  "בכיתה", "כיתה", "לומד", "לומדת", "לומדים", "נרשם", "נרשמת", "נרשמנו",
  "רשום", "רשומה", "מעוניין", "מעוניינת", "מעוניינים", "משתתף", "משתתפת",
  "של", "שלי", "שלנו", "שלו", "שלה", "עם", "בבקשה", "תודה", "שאלה", "שאלות",
  "מתי", "איפה", "איך", "כמה", "האם", "אבל", "וגם", "גם", "כבר", "עוד",
  "הבן", "הבת", "הילד", "הילדה", "בן", "בת", "ילד", "ילדה", "תלמיד", "תלמידה",
  "גר", "גרה", "הולך", "הולכת", "רוצים", "יכול", "יכולה", "צריכים",
]);

/**
 * לוקח את המילים שנלכדו אחרי מילת ההקדמה, עוצר במילה הראשונה שאינה שם,
 * ומגביל לשתי מילים (שם פרטי + משפחה).
 */
function refineName(captured: string): string | null {
  const words: string[] = [];
  for (const w of captured.trim().split(/\s+/)) {
    if (NAME_STOPWORDS.has(w)) break;
    words.push(w);
    if (words.length === 2) break;
  }
  return words.length > 0 ? words.join(" ") : null;
}

const RULES: Rule[] = [
  {
    kind: "EMAIL",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  {
    // כרטיס אשראי - 13-19 ספרות עם רווחים/מקפים, מאומת ב-Luhn.
    kind: "CARD",
    pattern: /\b(?:\d[ -]?){13,19}\b/g,
    accept: (m) => luhn(m.replace(/\D/g, "")) && m.replace(/\D/g, "").length >= 13,
  },
  {
    // טלפון ישראלי: 05X-XXXXXXX, 0X-XXXXXXX, +972..., 972...
    kind: "PHONE",
    pattern: /(?:\+?972[- ]?|\b0)(?:[23489]|5[0-9]|7[0-9])[- ]?\d{3}[- ]?\d{4}\b/g,
  },
  {
    // תעודת זהות: 8-9 ספרות שעוברות את ספרת הביקורת.
    kind: "ID",
    pattern: /\b\d{8,9}\b/g,
    accept: (m) => isValidIsraeliId(m),
  },
  {
    // רשת ביטחון: כל רצף של 7 ספרות ומעלה שלא נתפס למעלה. עדיף לנקות
    // מספר תמים מאשר להדליף ת"ז שהוקלדה עם שגיאת הקלדה.
    kind: "NUM",
    pattern: /\b\d{7,}\b/g,
  },
  {
    // כתובת מגורים: "רחוב X 12", "ברחוב X 12/3".
    kind: "ADDR",
    pattern: /\b(?:רח['׳]|רחוב|שד['׳]|שדרות|ברחוב)\s+[֐-׿"'׳״\-\s]{2,30}?\s+\d{1,4}[א-ת]?(?:\s*\/\s*\d{1,3})?/g,
  },
  {
    // שם מלא שהוצג במפורש: "קוראים לי דנה כהן", "שמי דנה כהן",
    // "הבן שלי יואב לוי". דיוק גבוה בכוונה - עדיף לפספס מאשר לנקות
    // בטעות מילים רגילות ולשבש את השיחה.
    kind: "NAME",
    pattern:
      /(?:קוראים לי|שמי|שם הילד(?:ה)?|הבן שלי|הבת שלי|הילד שלי|הילדה שלי|שם מלא)\s*[:,-]?\s*([֐-׿]{2,}(?:\s+[֐-׿]{2,}){0,2})/g,
    refine: refineName,
  },
];

function luhn(digits: string): boolean {
  if (digits.length < 12) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/**
 * מנקה טקסט. `existing` מאפשר להמשיך מיפוי של שיחה קיימת, כך שאותו
 * ערך מקבל את אותו סמן לאורך כל השיחה והמודל מבין שמדובר באותו אדם.
 */
export function redact(text: string, existing: RedactionMap = {}): RedactionResult {
  const map: RedactionMap = { ...existing };
  const reverse = new Map<string, string>();
  const counters = new Map<PiiKind, number>();

  for (const [token, value] of Object.entries(map)) {
    reverse.set(value, token);
    const m = /^\[\[([A-Z]+)_(\d+)\]\]$/.exec(token);
    if (m) {
      const kind = m[1] as PiiKind;
      const n = Number(m[2]);
      counters.set(kind, Math.max(counters.get(kind) ?? 0, n));
    }
  }

  const kinds = new Set<PiiKind>();
  let clean = text;

  for (const rule of RULES) {
    clean = clean.replace(rule.pattern, (match: string, ...rest: unknown[]) => {
      // String.replace מעביר את מיקום ההתאמה כארגומנט השני כשאין קבוצת
      // לכידה, ולכן בודקים במפורש שקיבלנו מחרוזת ולא מספר.
      const captured = typeof rest[0] === "string" ? rest[0] : undefined;
      // כשיש קבוצת לכידה (שם), מנקים רק אותה ומשאירים את מילת ההקדמה,
      // כדי שהמודל יבין מה הסמן מייצג.
      const raw = (captured ?? match).trim();
      if (!raw) return match;
      const value = rule.refine ? rule.refine(raw) : raw;
      if (!value) return match;
      if (rule.accept && !rule.accept(value)) return match;
      if (value.includes("[[")) return match; // כבר נוקה בסבב קודם

      let token = reverse.get(value);
      if (!token) {
        const n = (counters.get(rule.kind) ?? 0) + 1;
        counters.set(rule.kind, n);
        token = `[[${rule.kind}_${n}]]`;
        map[token] = value;
        reverse.set(value, token);
      }
      kinds.add(rule.kind);
      return captured ? match.replace(value, token) : token;
    });
  }

  return { clean, map, kinds: [...kinds] };
}

/** מחזיר את הערכים האמיתיים לטקסט שהמודל הפיק, לפני השליחה להורה. */
export function rehydrate(text: string, map: RedactionMap): string {
  let out = text;
  for (const [token, value] of Object.entries(map)) {
    out = out.split(token).join(value);
  }
  return out;
}

/**
 * שסתום ביטחון אחרון לפני קריאה ל-API. אם למרות הניקוי נותר מזהה בטקסט,
 * עדיף להיכשל ברעש מאשר לשלוח אותו החוצה בשקט.
 */
export function assertClean(text: string): void {
  const leaks: string[] = [];
  for (const rule of RULES) {
    if (rule.kind === "NAME" || rule.kind === "ADDR") continue; // זיהוי הסתברותי, לא חוסם
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    for (const m of text.matchAll(re)) {
      const v = (m[1] ?? m[0]).trim();
      if (rule.accept && !rule.accept(v)) continue;
      leaks.push(rule.kind);
    }
  }
  if (leaks.length > 0) {
    throw new Error(
      `זוהה מזהה אישי שלא נוקה (${[...new Set(leaks)].join(", ")}). הקריאה ל-API בוטלה.`,
    );
  }
}
