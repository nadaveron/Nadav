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
import { redact, rehydrate, type RedactionMap } from "../privacy/redact.ts";
import { think } from "../brain/claude.ts";
import type { StoredTurn } from "../store/repo.ts";
import type { WhatsAppProvider } from "../whatsapp/provider.ts";
import {
  availablePictures,
  createTemplate,
  deleteTemplate,
  getNumberStatus,
  getProfile,
  getTemplates,
  REQUIRED_TEMPLATES,
  setProfile,
  setProfilePicture,
  type BusinessProfile,
  type NumberStatus,
  type TemplateStatus,
} from "../whatsapp/profile.ts";

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
<header><a href="/admin">חוג לכל ילד — תיבת הנציג</a>
  &nbsp;·&nbsp; <a href="/admin/test">בדיקת הבוט</a></header>
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
        `<p class="muted">${rows.length} שיחות · <strong>${waiting} ממתינות לך</strong>
         · <a href="/admin/profile">פרופיל העסק</a> · <a href="/admin/test">בדיקה</a></p>${list}`,
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
    const viaTemplate = req.query.t === "1";
    /**
     * טופס נפרד, ובמכוון לא בתוך טופס השליחה: HTML אינו מתיר קינון
     * טפסים, והדפדפן מבטל את הפנימי - מה שהפך את הכפתור הזה לכפתור
     * שליחה של הטופס החיצוני, דרש טקסט, ושלח אותו במקום להחליף מצב.
     */
    const toggle =
      conv.state === "human"
        ? `<form method="post" action="/admin/c/${id}/bot">
             <button class="sec" type="submit">החזר את הבוט לשיחה</button>
             <span class="muted">הבוט יענה שוב על ההודעה הבאה</span>
           </form>`
        : `<form method="post" action="/admin/c/${id}/hold">
             <button class="sec" type="submit">השתק את הבוט ותפוס את השיחה</button>
             <span class="muted">שליחת תשובה עושה זאת ממילא</span>
           </form>`;

    res.send(
      PAGE(
        `שיחה עם ${phone}`,
        `${viaTemplate ? `<div class="card"><strong>ההודעה נשלחה כתבנית</strong>
          <div class="muted">עברו יותר מ-24 שעות מההודעה האחרונה של ההורה,
          ולכן היא נשלחה דרך התבנית המאושרת. ההורה מקבל אותה כפסקה אחת,
          בלי ירידות שורה.</div></div>` : ""}
        <div class="card">
          <div class="row"><strong>${esc(phone)}</strong>
          <span class="tag ${conv.state}">${conv.state === "human" ? "הבוט מושתק" : "הבוט מטפל"}</span></div>
          <div class="muted">${conv.state === "human" ? "תשובה שתשלח כאן תגיע להורה בווטסאפ." : "שליחת תשובה תשתיק אוטומטית את הבוט בשיחה הזו."}</div>
        </div>
        <div class="card">${lines || "<em>אין הודעות</em>"}</div>
        <div class="card">
          <form method="post" action="/admin/c/${id}/reply">
            <textarea name="body" required placeholder="כתוב תשובה להורה..."></textarea>
            <div style="margin-top:10px"><button type="submit">שלח בווטסאפ</button></div>
          </form>
        </div>
        <div class="card">${toggle}</div>`,
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

    /**
     * מטא חוסמת הודעה חופשית אחרי 24 שעות מההודעה האחרונה של ההורה.
     * כשהמענה האנושי אינו יומי זה קורה הרבה, ולכן יש נתיב גיבוי: תבנית
     * מאושרת, שעוברת בכל שעה. הטקסט נשלח בה כפסקה רציפה, כי מטא אינה
     * מתירה ירידות שורה בתוך משתנה של תבנית.
     */
    let sentAsTemplate = false;
    try {
      await provider.sendText(phone, body);
    } catch (freeFormErr) {
      const { replyTemplate, replyTemplateLang } = config.handoff;
      if (!replyTemplate) {
        log.error("שליחת תשובת נציג נכשלה ואין תבנית גיבוי", {
          conv: id,
          error: String(freeFormErr),
        });
        res.status(502).send(
          PAGE(
            "השליחה נכשלה",
            `<div class="card"><strong>ההודעה לא נשלחה.</strong>
             <p>ככל הנראה עברו יותר מ-24 שעות מההודעה האחרונה של ההורה, ומטא
             חוסמת הודעה חופשית אחרי הזמן הזה.</p>
             <p>אפשר לפתור את זה לתמיד: הגדירו תבנית תשובה מאושרת
             (<code>META_REPLY_TEMPLATE</code>) וההודעות יעברו בכל שעה. ראו README.</p>
             <p>בינתיים — יש להתקשר להורה.</p>
             <span class="muted">${esc(String(freeFormErr).slice(0, 250))}</span>
             <p><a href="/admin/c/${id}">חזרה לשיחה</a></p></div>`,
          ),
        );
        return;
      }

      try {
        // פסקה אחת רציפה: משתנה בתבנית של מטא אינו יכול להכיל ירידת שורה.
        await provider.sendTemplate(phone, replyTemplate, replyTemplateLang, [
          body.replace(/\s+/g, " ").slice(0, 900),
        ]);
        sentAsTemplate = true;
        log.info("תשובת נציג נשלחה כתבנית מחוץ לחלון", { conv: id });
      } catch (templateErr) {
        log.error("שליחת תשובת נציג נכשלה גם בתבנית", {
          conv: id,
          error: String(templateErr),
        });
        res.status(502).send(
          PAGE(
            "השליחה נכשלה",
            `<div class="card"><strong>ההודעה לא נשלחה, גם לא כתבנית.</strong>
             <p>בדקו שהתבנית <code>${esc(config.handoff.replyTemplate)}</code>
             מאושרת במטא ושהשם מדויק.</p>
             <span class="muted">${esc(String(templateErr).slice(0, 250))}</span>
             <p><a href="/admin/c/${id}">חזרה לשיחה</a></p></div>`,
          ),
        );
        return;
      }
    }

    // נציג שנכנס לשיחה תופס אותה: הבוט מושתק כדי שלא ידבר מעליו.
    repo.setHumanHandoff(id, config.handoff.hours);
    const conv = repo.getConversationById(id);
    const { clean, map } = redact(body, conv?.redactionMap ?? {});
    repo.saveRedactionMap(id, map);
    repo.addMessage({ conversationId: id, role: "human", raw: body, clean });
    log.info("נציג השיב בשיחה", { conv: id, viaTemplate: sentAsTemplate });

    res.redirect(`/admin/c/${id}${sentAsTemplate ? "?t=1" : ""}`);
  });

  r.post("/c/:id/hold", (req, res) => {
    repo.setHumanHandoff(Number(req.params.id), config.handoff.hours);
    res.redirect(`/admin/c/${req.params.id}`);
  });

  r.post("/c/:id/bot", (req, res) => {
    repo.returnToBot(Number(req.params.id));
    res.redirect(`/admin/c/${req.params.id}`);
  });

  // ---------------------------------------------------------------------
  //  בדיקת הבוט - שיחה עם המנוע בלי לערב ווטסאפ ובלי לגעת במסד הנתונים
  // ---------------------------------------------------------------------

  /**
   * ההיסטוריה נשמרת בשדה מוסתר בטופס ולא בשרת. כך אפשר לבדוק שיחה
   * רב-תורית בלי מצב, בלי עוגיות, ובלי ללכלך את היסטוריית הייצור.
   */
  interface TestTurn {
    role: "user" | "assistant";
    text: string;
  }

  function renderTest(turns: TestTurn[], note?: string): string {
    const bubbles = turns
      .map(
        (t) =>
          `<div class="msg ${t.role === "user" ? "from-user" : "from-bot"}">` +
          `<div class="muted">${t.role === "user" ? "הורה" : "הבוט"}</div>${esc(t.text)}</div>`,
      )
      .join("");

    return PAGE(
      "בדיקת הבוט",
      `<div class="card">
        <strong>בדיקה — ווטסאפ אינו מעורב</strong>
        <div class="muted">כתבו כאן כמו שהורה היה כותב, וראו מה הבוט עונה.
        השיחה הזו אינה נשמרת ואינה מופיעה בתיבת הנציג. כל שאלה היא קריאה
        אמיתית למודל ועולה כמה אגורות.</div>
      </div>
      ${turns.length ? `<div class="card">${bubbles}</div>` : ""}
      ${note ? `<div class="card">${note}</div>` : ""}
      <div class="card">
        <form method="post" action="/admin/test">
          <input type="hidden" name="history" value="${esc(JSON.stringify(turns))}">
          <textarea name="q" required autofocus
            placeholder="למשל: הילד שלי בכיתה ג, אפשר להצטרף?"></textarea>
          <div class="row" style="margin-top:10px">
            <button type="submit">שלח</button>
            <a class="tag bot" href="/admin/test" style="padding:10px 18px">התחל שיחה חדשה</a>
          </div>
        </form>
      </div>`,
    );
  }

  r.get("/test", (_req, res) => res.send(renderTest([])));

  r.post("/test", async (req, res) => {
    const body = req.body as { q?: string; history?: string };
    const question = String(body.q ?? "").trim();

    let turns: TestTurn[] = [];
    try {
      const parsed: unknown = JSON.parse(body.history || "[]");
      if (Array.isArray(parsed)) turns = parsed.slice(-12) as TestTurn[];
    } catch {
      turns = [];
    }

    if (!question) {
      res.send(renderTest(turns));
      return;
    }

    // מסלול זהה לייצור: ניקוי מזהים לפני המודל, והחזרתם רק בתצוגה.
    let map: RedactionMap = {};
    const history: StoredTurn[] = [];
    for (const t of turns) {
      const c = redact(t.text, map);
      map = c.map;
      history.push({ role: t.role, clean: c.clean });
    }
    const cleaned = redact(question, map);
    map = cleaned.map;

    turns.push({ role: "user", text: question });

    try {
      const result = await think(history, cleaned.clean);
      const answer = result.refused || !result.reply.trim()
        ? "(המודל לא הפיק תשובה — בייצור זה היה מוביל להסלמה לנציג)"
        : rehydrate(result.reply, map);
      turns.push({ role: "assistant", text: answer });

      const flags: string[] = [];
      if (result.decision.escalation)
        flags.push(`הוסלם לנציג — ${esc(result.decision.escalation.reason)}`);
      if (result.decision.referral)
        flags.push(`הופנה למפעיל — ${esc(result.decision.referral.operator)}`);
      const redacted = Object.keys(map).length;
      if (redacted) flags.push(`${redacted} מזהים אישיים נוקו לפני השליחה למודל`);

      res.send(renderTest(turns, flags.length ? flags.join("<br>") : undefined));
    } catch (err) {
      log.error("בדיקת הבוט נכשלה", { error: String(err) });
      turns.push({ role: "assistant", text: "(שגיאה)" });
      res.send(
        renderTest(turns, `<strong>הקריאה למודל נכשלה</strong><br>
        <span class="muted">${esc(String(err).slice(0, 400))}</span>`),
      );
    }
  });

  // --- פרופיל העסק בווטסאפ ---
  //
  // הממשק של מטא נועל את כל מסך הפרופיל כשאישור שם מסחרי ממתין. ה-API
  // אינו נעול, ולכן הדף הזה קיים: הוא כותב ישירות למספר, בלי לעבור דרך
  // המסך החסום.

  /**
   * שלוש הקריאות נאספות בנפרד ובלי לתלות אחת בשנייה: אם מצב התבניות
   * נכשל, עדיין צריך לראות את מצב השם ואת הפרופיל.
   */
  interface ProfileView {
    profile: BusinessProfile;
    status?: NumberStatus;
    templates?: TemplateStatus[] | null;
    errors: string[];
  }

  async function loadProfileView(): Promise<ProfileView> {
    const errors: string[] = [];
    const view: ProfileView = { profile: {}, errors };
    await Promise.all([
      getProfile().then(
        (p) => { view.profile = p; },
        (e) => { errors.push(`פרופיל: ${String(e).slice(0, 300)}`); },
      ),
      getNumberStatus().then(
        (st) => { view.status = st; },
        (e) => { errors.push(`מצב המספר: ${String(e).slice(0, 300)}`); },
      ),
      getTemplates().then(
        (t) => { view.templates = t; },
        (e) => { errors.push(`תבניות: ${String(e).slice(0, 300)}`); },
      ),
    ]);
    return view;
  }

  /** התרגום של מצבי השם המסחרי אצל מטא. */
  const NAME_STATUS: Record<string, string> = {
    APPROVED: "אושר",
    PENDING_REVIEW: "ממתין לאישור מטא",
    DECLINED: "נדחה",
    EXPIRED: "פג תוקף",
    AVAILABLE_WITHOUT_REVIEW: "בתוקף, לא נדרש אישור",
    NONE: "לא הוגשה בקשה",
    NON_EXISTS: "אין בקשה פתוחה",
  };

  function nameLabel(code?: string): string {
    if (!code) return "לא ידוע";
    return NAME_STATUS[code] ?? code;
  }

  function renderProfile(view: ProfileView, note?: string): string {
    const current = view.profile;
    const st = view.status;
    const error = view.errors.length ? view.errors.join(" · ") : undefined;
    // שני שדות נפרדים: name_status הוא מצב השם שבתוקף כרגע, ו-new_name_status
    // הוא מצב בקשה לשם חדש. בקשה שממתינה מופיעה רק בשני, ולכן שניהם מוצגים.
    const pendingName = st?.new_name_status === "PENDING_REVIEW";
    const statusCard = st
      ? `<div class="card">
          <div class="row"><strong>המספר</strong>
            <span class="tag ${st.name_status === "APPROVED" && !pendingName ? "bot" : "human"}">${esc(
              pendingName ? "שם חדש ממתין לאישור" : nameLabel(st.name_status),
            )}</span></div>
          <div class="muted" style="margin-top:6px">
            השם שההורים רואים: <strong>${esc(st.verified_name ?? "—")}</strong><br>
            מצב השם הנוכחי: ${esc(nameLabel(st.name_status))}<br>
            בקשה לשם חדש: ${esc(nameLabel(st.new_name_status))}<br>
            מספר: ${esc(st.display_phone_number ?? "—")}<br>
            דירוג איכות: ${esc(st.quality_rating ?? "—")} ·
            מגבלת שליחה: ${esc(st.messaging_limit_tier ?? "—")}<br>
            חשבון עסקי רשמי: ${st.is_official_business_account ? "כן" : "לא"}
          </div>
        </div>`
      : "";
    const tpl = view.templates;
    const byName = new Map((tpl ?? []).map((t) => [t.name, t]));
    const missing = REQUIRED_TEMPLATES.filter((req) => !byName.has(req.name));
    const tplCard =
      tpl === null || tpl === undefined
        ? `<div class="card"><strong>תבניות</strong>
            <div class="muted">כדי להציג את מצב התבניות נדרש להגדיר את
            META_WABA_ID במשתני הסביבה — מזהה חשבון הווטסאפ העסקי,
            שמופיע ב-WhatsApp Manager.</div></div>`
        : `<div class="card">
            <strong>תבניות</strong>
            <div class="muted" style="margin-top:6px">
            ${REQUIRED_TEMPLATES.map((req) => {
              const found = byName.get(req.name);
              const state = found ? esc(found.status) : "לא נוצרה";
              const why =
                found?.rejected_reason && found.rejected_reason !== "NONE"
                  ? ` <span class="tag human">${esc(found.rejected_reason)}</span>`
                  : "";
              // תבנית שנדחתה אינה ניתנת ליצירה מחדש באותו שם, ולכן ההגשה
              // החוזרת מוחקת אותה קודם. הכפתור מופיע רק עליה.
              const again =
                found && found.status === "REJECTED"
                  ? `<form method="post" action="/admin/profile/templates">
                       <input type="hidden" name="resubmit" value="${esc(req.name)}">
                       <button type="submit">מחק והגש מחדש</button>
                     </form>`
                  : "";
              return `<div style="margin-bottom:10px">
                <strong>${esc(req.name)}</strong> — ${state}${why}<br>
                ${esc(req.purpose)}<br>
                אחרי האישור: <code>${esc(req.envVar)}=${esc(req.name)}</code>
                <pre style="white-space:pre-wrap;background:rgba(127,127,127,.12);
                  padding:8px;border-radius:8px;margin:6px 0;font:inherit">${esc(req.body)}</pre>
                ${again}
              </div>`;
            }).join("")}
            ${
              (tpl ?? []).filter((t) => !REQUIRED_TEMPLATES.some((r) => r.name === t.name))
                .map((t) => `${esc(t.name)} — ${esc(t.status)}<br>`).join("")
            }
            </div>
            ${
              missing.length
                ? `<form method="post" action="/admin/profile/templates">
                     <button type="submit">שלח ${missing.length === 1 ? "תבנית" : `${missing.length} תבניות`} לאישור מטא</button>
                   </form>
                   <div class="muted" style="margin-top:8px">האישור אינו מיידי —
                   מטא בודקת, בדרך כלל תוך דקות עד שעות. אחרי שהמצב עובר ל-APPROVED
                   צריך להוסיף את משתני הסביבה שלמעלה ב-Render.</div>`
                : `<div class="muted">שתי התבניות קיימות. ודאו ששתיהן APPROVED
                   ושמשתני הסביבה מצביעים עליהן.</div>`
            }
          </div>`;
    const site = current.websites?.[0] ?? "";
    const pics = availablePictures();
    const pic = current.profile_picture_url
      ? `<img src="${esc(current.profile_picture_url)}" alt="תמונת הפרופיל הנוכחית"
           style="width:110px;height:110px;border-radius:50%;object-fit:cover">`
      : `<span class="muted">אין תמונת פרופיל.</span>`;

    return PAGE(
      "פרופיל העסק",
      `<p class="muted"><a href="/admin">&rarr; חזרה לתיבה</a></p>
      ${error ? `<div class="card"><strong>העדכון נכשל</strong><br>
        <span class="muted">${esc(error)}</span></div>` : ""}
      ${note ? `<div class="card"><strong>${esc(note)}</strong></div>` : ""}
      <div class="card">
        <strong>מה שההורים רואים</strong>
        <div class="muted">כל מה שכאן נכתב ישירות דרך ה-API של מטא, ולכן
        עובד גם בזמן שאישור השם המסחרי עדיין ממתין.</div>
      </div>
      ${statusCard}
      ${tplCard}
      <div class="card">
        <div class="row"><strong>תמונת פרופיל</strong></div>
        <div style="margin:10px 0">${pic}</div>
        ${pics.length
          ? `<form method="post" action="/admin/profile/picture">
               <label class="muted">קובץ מתוך התיקייה assets</label>
               <select name="file" style="width:100%;padding:9px;border-radius:8px;
                 border:1px solid #cbd5e1;font:inherit;margin:6px 0 10px">
                 ${pics.map((f) => `<option value="${esc(f)}">${esc(f)}</option>`).join("")}
               </select>
               <button type="submit">העלה תמונה</button>
             </form>`
          : `<div class="muted">לא נמצאו קבצים בתיקיית assets.</div>`}
      </div>
      <div class="card">
        <form method="post" action="/admin/profile">
          <label class="muted">שורת הסטטוס (About) — עד 139 תווים</label>
          <textarea name="about" style="min-height:52px">${esc(current.about ?? "")}</textarea>
          <label class="muted">תיאור — עד 512 תווים</label>
          <textarea name="description">${esc(current.description ?? "")}</textarea>
          <label class="muted">אתר</label>
          <textarea name="website" style="min-height:44px">${esc(site)}</textarea>
          <label class="muted">דואר אלקטרוני</label>
          <textarea name="email" style="min-height:44px">${esc(current.email ?? "")}</textarea>
          <label class="muted">כתובת</label>
          <textarea name="address" style="min-height:44px">${esc(current.address ?? "")}</textarea>
          <div class="row" style="margin-top:10px"><button type="submit">שמור</button></div>
        </form>
      </div>`,
    );
  }

  r.get("/profile", async (_req, res) => {
    res.send(renderProfile(await loadProfileView()));
  });

  r.post("/profile", async (req, res) => {
    const b = req.body as Record<string, string | undefined>;
    const text = (k: string): string => String(b[k] ?? "").trim();
    try {
      const current = await getProfile();
      const fields: Partial<BusinessProfile> = {};
      // שדה שרוקן במכוון נשלח כמחרוזת ריקה, כדי שאפשר יהיה גם למחוק ערך.
      // שדה שהיה ריק ונשאר ריק אינו נשלח כלל - אין סיבה לבקש ממטא לאמת
      // ערך ריק שממילא לא השתנה.
      const put = (k: "about" | "description" | "email" | "address", was?: string): void => {
        const now = text(k);
        if (now || (was ?? "")) fields[k] = now;
      };
      put("about", current.about);
      put("description", current.description);
      put("email", current.email);
      put("address", current.address);
      const site = text("website");
      if (site || current.websites?.length) fields.websites = site ? [site] : [];

      await setProfile(fields);
      res.send(renderProfile(await loadProfileView(), "הפרופיל עודכן."));
    } catch (err) {
      log.error("עדכון פרופיל העסק נכשל", { error: String(err) });
      const view = await loadProfileView();
      view.errors.unshift(String(err).slice(0, 400));
      res.send(renderProfile(view));
    }
  });

  r.post("/profile/picture", async (req, res) => {
    const file = String((req.body as { file?: string }).file ?? "");
    try {
      // רק שם קובץ, בלי נתיב - כדי שערך שהומצא בבקשה לא יקרא קובץ אחר בשרת.
      if (!availablePictures().includes(file)) throw new Error("קובץ לא מוכר");
      await setProfilePicture(file);
      res.send(renderProfile(await loadProfileView(), "תמונת הפרופיל הועלתה."));
    } catch (err) {
      log.error("העלאת תמונת פרופיל נכשלה", { error: String(err) });
      const view = await loadProfileView();
      view.errors.unshift(String(err).slice(0, 400));
      res.send(renderProfile(view));
    }
  });

  r.post("/profile/templates", async (req, res) => {
    const resubmit = String((req.body as { resubmit?: string }).resubmit ?? "");
    const view = await loadProfileView();
    const existing = new Set((view.templates ?? []).map((t) => t.name));

    if (resubmit) {
      if (!REQUIRED_TEMPLATES.some((t) => t.name === resubmit)) {
        res.status(400).send(PAGE("לא נמצא", `<div class="card">תבנית לא מוכרת.</div>`));
        return;
      }
      try {
        await deleteTemplate(resubmit);
        existing.delete(resubmit);
      } catch (err) {
        log.error("מחיקת תבנית נכשלה", { name: resubmit, error: String(err) });
        view.errors.push(`מחיקת ${resubmit}: ${String(err).slice(0, 300)}`);
      }
    }

    const created: string[] = [];
    for (const spec of REQUIRED_TEMPLATES) {
      if (resubmit && spec.name !== resubmit) continue;
      if (existing.has(spec.name)) continue;
      try {
        await createTemplate(spec);
        created.push(spec.name);
      } catch (err) {
        log.error("יצירת תבנית נכשלה", { name: spec.name, error: String(err) });
        view.errors.push(`${spec.name}: ${String(err).slice(0, 300)}`);
      }
    }
    // נטען מחדש כדי שהכרטיס יציג את המצב שמטא מחזירה, ולא את ההנחה שלנו.
    const after = await loadProfileView();
    after.errors.push(...view.errors);
    res.send(
      renderProfile(
        after,
        created.length ? `נשלחו לאישור: ${created.join(", ")}` : undefined,
      ),
    );
  });

  return r;
}
