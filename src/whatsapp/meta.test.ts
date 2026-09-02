import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { MetaCloudProvider, splitBody } from "./meta.ts";

const provider = new MetaCloudProvider();

function sign(body: string, secret: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

test("מקבל webhook עם חתימה תקינה", () => {
  const body = JSON.stringify({ object: "whatsapp_business_account" });
  const sig = sign(body, process.env.META_APP_SECRET!);
  assert.equal(provider.verifySignature(Buffer.from(body), sig), true);
});

test("דוחה חתימה שגויה, חסרה או באורך שונה", () => {
  const body = Buffer.from("{}");
  assert.equal(provider.verifySignature(body, sign("{}", "secret-אחר")), false);
  assert.equal(provider.verifySignature(body, undefined), false);
  assert.equal(provider.verifySignature(body, "sha256=abc"), false);
  assert.equal(provider.verifySignature(body, "לא בפורמט"), false);
});

test("מפרק מבנה webhook של מטא להודעה אחידה", () => {
  const messages = provider.parseWebhook({
    entry: [
      {
        changes: [
          {
            value: {
              contacts: [{ wa_id: "972501234567", profile: { name: "דנה" } }],
              messages: [
                {
                  id: "wamid.ABC",
                  from: "972501234567",
                  timestamp: "1735689600",
                  type: "text",
                  text: { body: "מתי נפתחת ההרשמה?" },
                },
              ],
            },
          },
        ],
      },
    ],
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0]!.id, "wamid.ABC");
  assert.equal(messages[0]!.from, "972501234567");
  assert.equal(messages[0]!.profileName, "דנה");
  assert.equal(messages[0]!.kind, "text");
  assert.equal(messages[0]!.text, "מתי נפתחת ההרשמה?");
});

test("מסמן הודעת מדיה כלא נתמכת במקום להפיל אותה", () => {
  const messages = provider.parseWebhook({
    entry: [
      {
        changes: [
          { value: { messages: [{ id: "wamid.IMG", from: "972501234567", type: "image" }] } },
        ],
      },
    ],
  });
  assert.equal(messages[0]!.kind, "unsupported");
});

test("התראות סטטוס אינן נחשבות להודעות נכנסות", () => {
  const messages = provider.parseWebhook({
    entry: [{ changes: [{ value: { statuses: [{ id: "wamid.X", status: "delivered" }] } }] }],
  } as never);
  assert.equal(messages.length, 0);
});

test("מפצל הודעה ארוכה בגבול שורה", () => {
  const parts = splitBody("שורה ראשונה\nשורה שנייה\nשורה שלישית", 20);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => p.length <= 20));
  assert.equal(parts.join("\n"), "שורה ראשונה\nשורה שנייה\nשורה שלישית");
});
