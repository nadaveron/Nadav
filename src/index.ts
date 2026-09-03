import express, { type Request, type Response } from "express";
import { config } from "./config.ts";
import { log } from "./logger.ts";
import { MetaCloudProvider } from "./whatsapp/meta.ts";
import type { WhatsAppProvider } from "./whatsapp/provider.ts";
import { handleInbound } from "./handler.ts";
import { inboxRouter } from "./admin/inbox.ts";
import { reloadKnowledge } from "./brain/knowledge.ts";
import { purgeExpiredRawContent } from "./store/repo.ts";
import { closeDb } from "./store/db.ts";

const provider: WhatsAppProvider = new MetaCloudProvider();

const app = express();
app.use(
  express.json({
    // חתימת מטא מחושבת על הבתים הגולמיים, לכן צריך לשמור אותם לפני הפענוח.
    verify: (req, _res, buf) => {
      (req as Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);

app.get("/health", (_req, res) => res.json({ ok: true }));

// תיבת הנציג - מענה אנושי על אותו מספר. נרשמת רק כשיש סיסמה חזקה.
if (config.inbox.enabled) {
  app.use("/admin", inboxRouter(provider));
  log.info("תיבת הנציג פעילה בנתיב /admin");
} else if (config.inbox.password) {
  log.warn("ADMIN_PASSWORD קצר מ-16 תווים - תיבת הנציג לא נטענה");
} else {
  log.info("תיבת הנציג כבויה (לא הוגדר ADMIN_PASSWORD)");
}

/** אימות חד פעמי מול מטא בזמן הגדרת ה-webhook. */
app.get("/webhook", (req: Request, res: Response) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === config.whatsapp.verifyToken) {
    log.info("אימות webhook מול מטא הצליח");
    res.status(200).send(String(challenge ?? ""));
    return;
  }
  log.warn("אימות webhook נכשל");
  res.sendStatus(403);
});

app.post("/webhook", (req: Request, res: Response) => {
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!raw || !provider.verifySignature(raw, req.get("x-hub-signature-256"))) {
    log.warn("נדחתה בקשת webhook עם חתימה שגויה");
    res.sendStatus(401);
    return;
  }

  // עונים למטא מיד. עיבוד ההודעה לוקח שניות, ומטא מנתקת אחרי כמה שניות
  // ושולחת שוב - מה שהיה מייצר תשובות כפולות להורה.
  res.sendStatus(200);

  const messages = provider.parseWebhook(req.body);
  for (const msg of messages) {
    handleInbound(provider, msg).catch((err) =>
      log.error("טיפול בהודעה נכשל", { error: String(err) }),
    );
  }
});

const server = app.listen(config.port, () => {
  log.info("הבוט עלה", {
    port: config.port,
    provider: provider.name,
    model: config.anthropic.model,
    effort: config.anthropic.effort,
    dryRun: config.dryRun,
  });
  reloadKnowledge();
});

// ניקוי תוכן גולמי שעבר את תקופת השמירה. רץ בעלייה ואחר כך פעם ביממה.
const purge = () => {
  try {
    const n = purgeExpiredRawContent();
    if (n > 0) log.info("נמחק תוכן גולמי שעבר את תקופת השמירה", { messages: n });
  } catch (err) {
    log.error("ניקוי תוכן ישן נכשל", { error: String(err) });
  }
};
purge();
const purgeTimer = setInterval(purge, 24 * 60 * 60 * 1000);

function shutdown(signal: string) {
  log.info("כיבוי", { signal });
  clearInterval(purgeTimer);
  server.close(() => {
    closeDb();
    process.exit(0);
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
