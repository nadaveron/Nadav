import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dueSlot,
  formatLocalTimestamp,
  formatTime,
  localNow,
  parseTime,
} from "./schedule.ts";

const TZ = "Asia/Jerusalem";
const OPTS = { timeZone: TZ, times: [parseTime("07:30"), parseTime("16:00")], days: [0, 1, 2, 3, 4] };

test("07:30 בשעון ישראל בחורף - נשלח", () => {
  // 2026-01-04 הוא יום ראשון. בחורף ישראל היא UTC+2.
  assert.equal(dueSlot(new Date("2026-01-04T05:30:00Z"), OPTS), "2026-01-04 07:30");
});

test("07:30 בשעון ישראל בקיץ - נשלח, בלי חישוב היסט ידני", () => {
  // 2026-07-05 הוא יום ראשון. בקיץ ישראל היא UTC+3.
  assert.equal(dueSlot(new Date("2026-07-05T04:30:00Z"), OPTS), "2026-07-05 07:30");
});

test("16:00 נשלח כמשבצת נפרדת מהבוקר", () => {
  assert.equal(dueSlot(new Date("2026-01-04T14:00:00Z"), OPTS), "2026-01-04 16:00");
});

test("שישי ושבת - בלי סיכום", () => {
  // 2026-01-02 שישי, 2026-01-03 שבת.
  assert.equal(dueSlot(new Date("2026-01-02T05:30:00Z"), OPTS), null);
  assert.equal(dueSlot(new Date("2026-01-03T05:30:00Z"), OPTS), null);
});

test("איחור קצר עדיין בתוך החלון, איחור ארוך כבר לא", () => {
  assert.equal(dueSlot(new Date("2026-01-04T05:38:00Z"), OPTS), "2026-01-04 07:30");
  // שעתיים אחרי - הפעלה מחדש בצהריים לא תשלח את סיכום הבוקר.
  assert.equal(dueSlot(new Date("2026-01-04T07:30:00Z"), OPTS), null);
});

test("לפני השעה - לא נשלח", () => {
  assert.equal(dueSlot(new Date("2026-01-04T05:29:00Z"), OPTS), null);
});

test("המפתח משתנה בין ימים, כדי שהשליחה תחזור מחר", () => {
  const a = dueSlot(new Date("2026-01-04T05:30:00Z"), OPTS);
  const b = dueSlot(new Date("2026-01-05T05:30:00Z"), OPTS);
  assert.notEqual(a, b);
});

test("חצות מתורגמת ל-0 ולא ל-24", () => {
  const midnight = localNow(new Date("2026-01-03T22:00:00Z"), TZ);
  assert.equal(midnight.minutes, 0);
  assert.equal(midnight.date, "2026-01-04");
});

test("שעה לא תקינה נופלת בעלייה", () => {
  assert.throws(() => parseTime("25:00"));
  assert.throws(() => parseTime("שבע וחצי"));
  assert.equal(formatTime(parseTime("7:05")), "07:05");
});

test("חותמת מהמסד מוצגת בשעון ישראל, לא ב-UTC", () => {
  // חורף: UTC+2. 10:15 ב-UTC הן 12:15 בישראל.
  const now = new Date("2026-01-20T12:00:00Z");
  assert.equal(formatLocalTimestamp("2026-01-04 10:15:03", TZ, now), "04.01.2026 12:15");
  // קיץ: UTC+3.
  assert.equal(formatLocalTimestamp("2026-07-05 10:15:03", TZ, now), "05.07.2026 13:15");
});

test("היום ואתמול מקבלים ניסוח קריא", () => {
  const now = new Date("2026-01-20T12:00:00Z"); // 14:00 בישראל
  assert.equal(formatLocalTimestamp("2026-01-20 07:05:00", TZ, now), "היום 09:05");
  assert.equal(formatLocalTimestamp("2026-01-19 20:40:00", TZ, now), "אתמול 22:40");
});

test("הודעה מאוחרת בערב נספרת ליום הישראלי הנכון", () => {
  // 22:30 UTC ב-19.1 הן 00:30 ב-20.1 בישראל - כלומר "היום".
  const now = new Date("2026-01-20T12:00:00Z");
  assert.equal(formatLocalTimestamp("2026-01-19 22:30:00", TZ, now), "היום 00:30");
});

test("חותמת לא תקינה מוחזרת כמו שהיא ולא מפילה את הדף", () => {
  assert.equal(formatLocalTimestamp("לא תאריך", TZ), "לא תאריך");
});
