import { test } from "node:test";
import assert from "node:assert/strict";
import { dueSlot, formatTime, localNow, parseTime } from "./schedule.ts";

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
