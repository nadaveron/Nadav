import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isLatest,
  markLatest,
  resetCoalesceState,
  runExclusive,
  waitForQuiet,
} from "./coalesce.ts";

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

test("הודעה שהגיעה אחריה הודעה נוספת מוותרת על התור", async () => {
  resetCoalesceState();
  // ממתינה: בזמן ההמתנה מגיעה ההודעה הבאה מאותה שיחה.
  const first = waitForQuiet(7, "wamid.A", 1, async () => {
    markLatest(7, "wamid.B");
  });
  assert.equal(await first, false);
});

test("ההודעה האחרונה בפרץ היא זו שעונה", async () => {
  resetCoalesceState();
  markLatest(7, "wamid.A");
  assert.equal(await waitForQuiet(7, "wamid.B", 1, async () => {}), true);
  assert.equal(isLatest(7, "wamid.A"), false);
});

test("שיחות שונות אינן משפיעות זו על זו", async () => {
  resetCoalesceState();
  markLatest(7, "wamid.A");
  markLatest(8, "wamid.B");
  assert.equal(await waitForQuiet(7, "wamid.A", 1, async () => {}), true);
  assert.equal(await waitForQuiet(8, "wamid.B", 1, async () => {}), true);
});

test("שני תורים באותה שיחה רצים בזה אחר זה ולא בחפיפה", async () => {
  resetCoalesceState();
  const order: string[] = [];
  const slow = runExclusive(7, async () => {
    order.push("א-התחיל");
    await tick();
    await tick();
    order.push("א-סיים");
  });
  const fast = runExclusive(7, async () => {
    order.push("ב-התחיל");
    order.push("ב-סיים");
  });
  await Promise.all([slow, fast]);
  assert.deepEqual(order, ["א-התחיל", "א-סיים", "ב-התחיל", "ב-סיים"]);
});

test("תור שנכשל אינו תוקע את התור הבא אחריו", async () => {
  resetCoalesceState();
  const failed = runExclusive(7, async () => {
    throw new Error("כשל");
  });
  await assert.rejects(failed);

  let ran = false;
  await runExclusive(7, async () => {
    ran = true;
  });
  assert.equal(ran, true);
});

test("שיחות שונות רצות במקביל", async () => {
  resetCoalesceState();
  const order: string[] = [];
  const a = runExclusive(7, async () => {
    order.push("7-התחיל");
    await tick();
    order.push("7-סיים");
  });
  const b = runExclusive(8, async () => {
    order.push("8-התחיל");
    await tick();
    order.push("8-סיים");
  });
  await Promise.all([a, b]);
  assert.deepEqual(order, ["7-התחיל", "8-התחיל", "7-סיים", "8-סיים"]);
});
