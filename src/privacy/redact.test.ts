import { test } from "node:test";
import assert from "node:assert/strict";
import { redact, rehydrate, isValidIsraeliId, assertClean } from "./redact.ts";

test("ספרת ביקורת של תעודת זהות", () => {
  assert.equal(isValidIsraeliId("000000018"), true);
  assert.equal(isValidIsraeliId("123456782"), true);
  assert.equal(isValidIsraeliId("123456789"), false);
});

test("מנקה תעודת זהות מהטקסט", () => {
  const { clean, map } = redact("הת״ז של הבן שלי היא 123456782, אפשר לרשום?");
  assert.ok(!clean.includes("123456782"), "ת״ז נותרה בטקסט");
  assert.ok(clean.includes("[[ID_1]]"));
  assert.equal(map["[[ID_1]]"], "123456782");
});

test("מנקה טלפון ואימייל", () => {
  const { clean, kinds } = redact("תחזרו אליי ל-050-1234567 או ל dana@example.com");
  assert.ok(!clean.includes("050-1234567"));
  assert.ok(!clean.includes("dana@example.com"));
  assert.ok(kinds.includes("PHONE"));
  assert.ok(kinds.includes("EMAIL"));
});

test("אותו ערך מקבל אותו סמן לאורך השיחה", () => {
  const first = redact("הת״ז היא 123456782");
  const second = redact("שוב, 123456782 בבקשה", first.map);
  assert.ok(second.clean.includes("[[ID_1]]"));
  assert.equal(Object.keys(second.map).length, 1, "נוצר סמן כפול לאותו ערך");
});

test("מנקה שם מלא שהוצג במפורש ומשאיר את מילת ההקדמה", () => {
  const { clean, map } = redact("קוראים לי דנה כהן ואני מקריית אונו");
  assert.ok(clean.includes("קוראים לי [[NAME_1]]"));
  assert.equal(map["[[NAME_1]]"], "דנה כהן");
});

test("לא מנקה מספרים תמימים כמו כיתה או מחיר", () => {
  const { clean } = redact("הבן שלי בכיתה ב, והשובר עולה 200 ש״ח");
  assert.ok(clean.includes("200"));
  assert.ok(clean.includes("כיתה ב"));
});

test("החזרת הערכים לתשובה של המודל", () => {
  const { map } = redact("הת״ז היא 123456782");
  const out = rehydrate("קיבלתי את תעודת הזהות [[ID_1]], תודה.", map);
  assert.equal(out, "קיבלתי את תעודת הזהות 123456782, תודה.");
});

test("שסתום הביטחון עוצר טקסט שנותר בו מזהה", () => {
  assert.throws(() => assertClean("הת״ז היא 123456782"));
  assert.doesNotThrow(() => assertClean("הת״ז היא [[ID_1]]"));
});

test("רצף ספרות ארוך נחסם גם אם אינו ת״ז תקינה", () => {
  const { clean } = redact("המספר שלי 987654321");
  assert.ok(!clean.includes("987654321"), "רצף ספרות ארוך דלף");
});
