import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

// config נקרא פעם אחת בעליית המודול ומוקפא, ולכן משתני הסביבה חייבים
// להיות מוגדרים לפני הייבוא. import דינמי אחרי ההגדרה עושה בדיוק את זה,
// ומשחרר את הבדיקות מתלות בסביבה חיצונית.
process.env.ANTHROPIC_API_KEY ??= "sk-ant-test";
process.env.META_PHONE_NUMBER_ID ??= "123";
process.env.META_ACCESS_TOKEN ??= "tok";
process.env.META_APP_SECRET = "test-secret";
process.env.META_VERIFY_TOKEN ??= "verify-me";
process.env.DATA_ENCRYPTION_KEY ??= crypto.randomBytes(32).toString("base64");
process.env.PHONE_HASH_PEPPER ??= "pepper";
process.env.DRY_RUN = "false";

const { MetaCloudProvider, splitBody } = await import("./meta.ts");
const provider = new MetaCloudProvider();

function sign(body: string, secret: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

/** מחליף fetch, מריץ פעולה, ומחזיר את גוף הבקשות שנשלחו. */
async function capture(fn: () => Promise<void>): Promise<Record<string, unknown>[]> {
  const sent: Record<string, unknown>[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    return new Response("", { status: 200 });
  }) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
  return sent;
}

test("מקבל webhook עם חתימה תקינה", () => {
  const body = JSON.stringify({ object: "whatsapp_business_account" });
  assert.equal(provider.verifySignature(Buffer.from(body), sign(body, "test-secret")), true);
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
      { changes: [{ value: { messages: [{ id: "wamid.IMG", from: "972501234567", type: "image" }] } }] },
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

test("בונה הודעת תבנית עם פרמטרים לפי הסדר", async () => {
  const sent = await capture(() =>
    provider.sendTemplate("972500000000", "escalation_alert", "he", [
      "הסלמה: תלונה",
      "972501234567",
      "ההורה מבקש החזר",
    ]),
  );

  const body = sent[0] as {
    type: string;
    to: string;
    template: {
      name: string;
      language: { code: string };
      components: { type: string; parameters: { type: string; text: string }[] }[];
    };
  };
  assert.equal(body.type, "template");
  assert.equal(body.to, "972500000000");
  assert.equal(body.template.name, "escalation_alert");
  assert.equal(body.template.language.code, "he");
  assert.deepEqual(
    body.template.components[0]!.parameters.map((p) => p.text),
    ["הסלמה: תלונה", "972501234567", "ההורה מבקש החזר"],
  );
});

test("הודעת טקסט ארוכה נשלחת בכמה בקשות נפרדות", async () => {
  const sent = await capture(() => provider.sendText("972500000000", "א".repeat(5000)));
  assert.equal(sent.length, 2, "הודעה מעל 4096 תווים לא פוצלה");
  assert.equal(sent[0]!.type, "text");
});
