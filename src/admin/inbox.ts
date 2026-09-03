/**
 * תיבת הנציג.
 *
 * מספר שמחובר ל-WhatsApp Cloud API אינו יכול לפעול במקביל באפליקציית
 * ווטסאפ, ולכן מענה אנושי על אותו מספר מחייב ממשק משלנו. זה הממשק.
 *
 * הוא נבנה בתוך האפליקציה ולא מול ספק חיצוני בכוונה: כל התמלולים מפוענחים
 * כאן ורק כאן, ואף פרט של תושב אינו עובר לצד שלישי.
 */
import express, { type Request, type Response, type NextFunction } from "express";
import crypto from "node:crypto";
import { config } from "../config.ts";
import { log } from "../logger.ts";
import * as repo from "../store/repo.ts";
import { redact } from "../privacy/redact.ts";
import type { WhatsAppProvider } from "../whatsapp/provider.ts";

/** מונע הזרקת HTML מתוכן שהורה שלח. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** השוואה בזמן קבוע, כדי שלא ניתן יהיה לנחש את הסיסמה תו-תו. */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function auth(req: Request, res: Response, next: NextFunction): void {
  const header = req.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const password = decoded.slice(decoded.indexOf(":") + 1);
    if (safeEqual(password, config.inbox.password)) {
      next();
      return;
    }
  }
  // כותרות HTTP חייבות להיות ASCII. realm בעברית מפיל את התגובה ב-500,
  // והדפדפן לעולם אינו מציג את חלון ההזדהות.
  res.set("WWW-Authenticate", 'Basic realm="Hug LeKol Yeled - Agent Inbox", charset="UTF-8"');
  res.status(401).type("text/plain; charset=utf-8").send("נדרשת הזדהות");
}

const PAGE = (title: string, body: string) => `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
  :root{color-scheme:light dark}
  *{box-sizing:border-box}
  body{margin:0;font:15px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;
       background:#f6f7f9;color:#111}
  @media(prefers-color-scheme:dark){body{background:#15171a;color:#e8e8e8}}
  header{background:#1f6feb;color:#fff;padding:14px 18px;font-weight:600}
  header a{color:#fff;text-decoration:none;opacity:.85}
  main{max-width:820px;margin:0 auto;padding:18px}
  .card{background:#fff;border-radius:10px;padding:14px;margin-bottom:10px;
        box-shadow:0 1px 3px rgba(0,0,0,.08);display:block;
        color:inherit;text-decoration:none}
  @media(prefers-color-scheme:dark){.card{background:#22262b;box-shadow:none}}
  .row{display:flex;justify-content:space-between;gap:10px;align-items:center}
  .tag{font-size:12px;padding:2px 9px;border-radius:99px;white-space:nowrap}
  .human{background:#fde68a;color:#78350f}
  .bot{background:#d1fae5;color:#065f46}
  .muted{color:#6b7280;font-size:13px}
  .msg{padding:9px 12px;border-radius:10px;margin:7px 0;max-width:85%;
       white-space:pre-wrap;word-wrap:break-word}
  .from-user{background:#e9ecef;color:#111}
  .from-bot{background:#dbeafe;color:#111;margin-inline-start:auto}
  .from-human{background:#fef3c7;color:#111;margin-inline-start:auto}
  textarea{width:100%;padding:10px;border-radius:8px;border:1px solid #cbd5e1;
           font:inherit;min-height:90px}
  button{background:#1f6feb;color:#fff;border:0;padding:10px 20px;
         border-radius:8px;font:inherit;cursor:pointer}
  button.sec{background:#6b7280}
  form{margin:0}
</style></head><body>
<header><a href="/admin">חוג לכל ילד — תיבת הנציג</a></header>
<main>${body}</main></body></html>`;

export function inboxRouter(provider: WhatsAppProvider): express.Router {
  const r = express.Router();
  r.use(auth);
  r.use(express.urlencoded({ extended: false }));

  // --- רשימת השיחות ---
  r.get("/", (_req, res) => {
    const rows = repo.listConversations(100);
    const waiting = rows.filter((c) => c.state === "human").length;

    const list = rows.length
      ? rows
          .map(
            (c) => `<a class="card" href="/admin/c/${c.id}">
        <div class="row">
          <strong>${esc(c.phone)}</strong>
          <span class="tag ${c.state}">${c.state === "human" ? "ממתין לך" : "הבוט מטפל"}</span>
        </div>
        <div class="muted">${esc(c.lastRole === "user" ? "הורה: " : "נענה: ")}${esc(
          c.lastMessage.slice(0, 90),
        )}</div>
        <div class="muted">${esc(c.updatedAt)} · ${c.messages} הודעות</div>
      </a>`,
          )
          .join("")
      : `<div class="card">עדיין אין שיחות.</div>`;

    res.send(
      PAGE(
        "תיבת הנציג",
        `<p class="muted">${rows.length} שיחות · <strong>${waiting} ממתינות לך</strong></p>${list}`,
      ),
    );
  });

  // --- שיחה בודדת ---
  r.get("/c/:id", (req, res) => {
    const id = Number(req.params.id);
    const conv = repo.getConversationById(id);
    if (!conv) {
      res.status(404).send(PAGE("לא נמצא", `<div class="card">שיחה ${id} לא נמצאה.</div>`));
      return;
    }

    const lines = repo
      .transcript(id)
      .map((l) => {
        const cls = l.role === "user" ? "from-user" : l.role === "human" ? "from-human" : "from-bot";
        const who = l.role === "user" ? "הורה" : l.role === "human" ? "אתה" : "בוט";
        const note = l.redactedOnly ? ' <span class="muted">(התוכן הגולמי נמחק)</span>' : "";
        return `<div class="msg ${cls}"><div class="muted">${who} · ${esc(l.at)}${note}</div>${esc(l.body)}</div>`;
      })
      .join("");

    const phone = repo.phoneOf(id) ?? "";
    const toggle =
      conv.state === "human"
        ? `<form method="post" action="/admin/c/${id}/bot"><button class="sec" type="submit">החזר את הבוט לשיחה</button></form>`
        : `<form method="post" action="/admin/c/${id}/hold"><button class="sec" type="submit">השתק את הבוט ותפוס את השיחה</button></form>`;

    res.send(
      PAGE(
        `שיחה עם ${phone}`,
        `<div class="card">
          <div class="row"><strong>${esc(phone)}</strong>
          <span class="tag ${conv.state}">${conv.state === "human" ? "הבוט מושתק" : "הבוט מטפל"}</span></div>
          <div class="muted">${conv.state === "human" ? "תשובה שתשלח כאן תגיע להורה בווטסאפ." : "שליחת תשובה תשתיק אוטומטית את הבוט בשיחה הזו."}</div>
        </div>
        <div class="card">${lines || "<em>אין הודעות</em>"}</div>
        <div class="card">
          <form method="post" action="/admin/c/${id}/reply">
            <textarea name="body" required placeholder="כתוב תשובה להורה..."></textarea>
            <div class="row" style="margin-top:10px">
              <button type="submit">שלח בווטסאפ</button>
              ${toggle}
            </div>
          </form>
        </div>`,
      ),
    );
  });

  // --- שליחת תשובה אנושית ---
  r.post("/c/:id/reply", async (req, res) => {
    const id = Number(req.params.id);
    const body = String((req.body as { body?: string }).body ?? "").trim();
    const phone = repo.phoneOf(id);
    if (!body || !phone) {
      res.redirect(`/admin/c/${id}`);
      return;
    }

    try {
      await provider.sendText(phone, body);
      // נציג שנכנס לשיחה תופס אותה: הבוט מושתק כדי שלא ידבר מעליו.
      repo.setHumanHandoff(id, config.handoff.hours);
      const conv = repo.getConversationById(id);
      const { clean, map } = redact(body, conv?.redactionMap ?? {});
      repo.saveRedactionMap(id, map);
      repo.addMessage({ conversationId: id, role: "human", raw: body, clean });
      log.info("נציג השיב בשיחה", { conv: id });
    } catch (err) {
      log.error("שליחת תשובת נציג נכשלה", { conv: id, error: String(err) });
      res.status(502).send(
        PAGE(
          "השליחה נכשלה",
          `<div class="card">ההודעה לא נשלחה.<br><span class="muted">${esc(String(err).slice(0, 300))}</span>
           <p>אם עברו יותר מ-24 שעות מההודעה האחרונה של ההורה, מטא חוסמת הודעה חופשית. במקרה כזה יש להתקשר.</p>
           <p><a href="/admin/c/${id}">חזרה לשיחה</a></p></div>`,
        ),
      );
      return;
    }
    res.redirect(`/admin/c/${id}`);
  });

  r.post("/c/:id/hold", (req, res) => {
    repo.setHumanHandoff(Number(req.params.id), config.handoff.hours);
    res.redirect(`/admin/c/${req.params.id}`);
  });

  r.post("/c/:id/bot", (req, res) => {
    repo.returnToBot(Number(req.params.id));
    res.redirect(`/admin/c/${req.params.id}`);
  });

  return r;
}
