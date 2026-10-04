/**
 * פרופיל העסק בווטסאפ - קריאה ועדכון דרך ה-Cloud API.
 *
 * הממשק של מטא מגיש את שדות הפרופיל ואת אישור השם המסחרי באותו מסך,
 * וכשאישור שם ממתין הוא חוסם גם את שאר העריכות. ה-API לא עושה את זה:
 * השם המסחרי והפרופיל הם שני משאבים נפרדים, ואפשר לעדכן את הפרופיל
 * בזמן שהשם עוד בבדיקה. זה הנתיב שהקובץ הזה פותח.
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.ts";
import { log } from "../logger.ts";

const GRAPH = "https://graph.facebook.com";

/** השדות שמטא מחזירה ומקבלת. websites הוא מערך, כל השאר מחרוזות. */
export interface BusinessProfile {
  about?: string;
  address?: string;
  description?: string;
  email?: string;
  vertical?: string;
  websites?: string[];
  profile_picture_url?: string;
}

const READ_FIELDS = [
  "about",
  "address",
  "description",
  "email",
  "vertical",
  "websites",
  "profile_picture_url",
].join(",");

function base(): string {
  return `${GRAPH}/${config.whatsapp.graphVersion}`;
}

async function graph(url: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Meta Graph API החזיר ${res.status}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : {};
}

export async function getProfile(): Promise<BusinessProfile> {
  const url =
    `${base()}/${config.whatsapp.phoneNumberId}/whatsapp_business_profile` +
    `?fields=${READ_FIELDS}`;
  const body = (await graph(url, {
    headers: { Authorization: `Bearer ${config.whatsapp.accessToken}` },
  })) as { data?: BusinessProfile[] };
  return body.data?.[0] ?? {};
}

/**
 * עדכון שדות הפרופיל. נשלחים רק השדות שהועברו - מטא משאירה את השאר
 * כפי שהם, ולכן אין סכנה שעדכון של שדה אחד ימחק אחר.
 */
export async function setProfile(
  fields: Partial<BusinessProfile> & { profile_picture_handle?: string },
): Promise<void> {
  if (config.dryRun) {
    log.info("DRY_RUN - לא עודכן פרופיל העסק", { fields: Object.keys(fields) });
    return;
  }
  await graph(`${base()}/${config.whatsapp.phoneNumberId}/whatsapp_business_profile`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.whatsapp.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", ...fields }),
  });
}

/**
 * מזהה האפליקציה נדרש רק להעלאת תמונה. אם לא הוגדר במשתני הסביבה,
 * שואלים את מטא למי שייך הטוקן - כך אין עוד ערך שצריך להעתיק ביד.
 */
async function appId(): Promise<string> {
  if (config.whatsapp.appId) return config.whatsapp.appId;
  const token = config.whatsapp.accessToken;
  const body = (await graph(
    `${base()}/debug_token?input_token=${encodeURIComponent(token)}` +
      `&access_token=${encodeURIComponent(token)}`,
  )) as { data?: { app_id?: string } };
  const id = body.data?.app_id;
  if (!id) {
    throw new Error(
      "לא הצלחתי לזהות את מזהה האפליקציה מהטוקן. הגדירו META_APP_ID במשתני הסביבה.",
    );
  }
  return id;
}

/**
 * העלאת קובץ ל-Resumable Upload API של מטא. התוצאה היא "ידית" (handle)
 * שאפשר להצמיד לפרופיל. מטא לא מקבלת כתובת תמונה ישירות.
 */
async function uploadHandle(bytes: Buffer, mime: string): Promise<string> {
  const id = await appId();
  const token = config.whatsapp.accessToken;

  const session = (await graph(
    `${base()}/${id}/uploads?file_length=${bytes.length}` +
      `&file_type=${encodeURIComponent(mime)}` +
      `&access_token=${encodeURIComponent(token)}`,
    { method: "POST" },
  )) as { id?: string };
  if (!session.id) throw new Error("מטא לא החזירה מזהה העלאה");

  const done = (await graph(`${base()}/${session.id}`, {
    method: "POST",
    headers: {
      // שלב ההעלאה דורש OAuth ולא Bearer - זו חריגה של ה-API הזה.
      Authorization: `OAuth ${token}`,
      file_offset: "0",
      "Content-Type": mime,
    },
    body: new Uint8Array(bytes),
  })) as { h?: string };
  if (!done.h) throw new Error("מטא לא החזירה ידית לקובץ שהועלה");
  return done.h;
}

/** התמונה נשמרת בתוך המאגר, כדי שהעלאה מחדש לא תלויה בקובץ שעל מחשב כלשהו. */
export function assetPath(name: string): string {
  return path.resolve(process.cwd(), "assets", name);
}

export async function setProfilePicture(file: string): Promise<void> {
  const full = assetPath(file);
  if (!fs.existsSync(full)) throw new Error(`קובץ התמונה לא נמצא: ${full}`);
  const bytes = fs.readFileSync(full);
  const mime = full.endsWith(".png") ? "image/png" : "image/jpeg";
  if (config.dryRun) {
    log.info("DRY_RUN - לא הועלתה תמונת פרופיל", { file, bytes: bytes.length });
    return;
  }
  const handle = await uploadHandle(bytes, mime);
  await setProfile({ profile_picture_handle: handle });
}

/** התמונות הזמינות להעלאה, לפי מה שנמצא בתיקיית assets. */
export function availablePictures(): string[] {
  const dir = path.resolve(process.cwd(), "assets");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(jpe?g|png)$/i.test(f))
    .sort();
}

/**
 * מצב המספר עצמו - להבדיל מהפרופיל. כאן יושב השם המסחרי ומצב האישור שלו,
 * וזה מה שעונה על השאלה "האם השם בעברית אושר".
 */
export interface NumberStatus {
  verified_name?: string;
  display_phone_number?: string;
  /** APPROVED / PENDING_REVIEW / DECLINED / EXPIRED / NONE / NON_EXISTS */
  name_status?: string;
  /** מצב בקשה לשם חדש, אם הוגשה. NON_EXISTS - אין בקשה פתוחה. */
  new_name_status?: string;
  quality_rating?: string;
  code_verification_status?: string;
  is_official_business_account?: boolean;
  messaging_limit_tier?: string;
}

const STATUS_FIELDS = [
  "verified_name",
  "display_phone_number",
  "name_status",
  "new_name_status",
  "quality_rating",
  "code_verification_status",
  "is_official_business_account",
  "messaging_limit_tier",
].join(",");

export async function getNumberStatus(): Promise<NumberStatus> {
  const url = `${base()}/${config.whatsapp.phoneNumberId}?fields=${STATUS_FIELDS}`;
  return (await graph(url, {
    headers: { Authorization: `Bearer ${config.whatsapp.accessToken}` },
  })) as NumberStatus;
}

export interface TemplateStatus {
  name: string;
  status: string;
  category?: string;
  language?: string;
  /** מדוע נדחתה, כשמטא מוסרת סיבה. */
  rejected_reason?: string;
}

/**
 * מצב התבניות המאושרות. בלי תבנית התראה מאושרת אין התראות על הסלמות,
 * ולכן המצב שלהן שייך לאותו מסך.
 *
 * דורש את מזהה חשבון הווטסאפ העסקי (WABA), שאינו נגזר מהטוקן.
 */
export async function getTemplates(): Promise<TemplateStatus[] | null> {
  if (!config.whatsapp.wabaId) return null;
  const url =
    `${base()}/${config.whatsapp.wabaId}/message_templates` +
    `?fields=name,status,category,language,rejected_reason&limit=50`;
  const body = (await graph(url, {
    headers: { Authorization: `Bearer ${config.whatsapp.accessToken}` },
  })) as { data?: TemplateStatus[] };
  return body.data ?? [];
}


/**
 * שתי התבניות שהמערכת צריכה.
 *
 * מטא מחייבת שהטקסט לא יתחיל ולא יסתיים במשתנה, ודורשת דוגמה לכל משתנה
 * לצורך הבדיקה. שתי המגבלות האלה מעצבות את הניסוח כאן.
 */
export interface TemplateSpec {
  name: string;
  language: string;
  category: string;
  body: string;
  example: string[];
  /**
   * כפתור קישור, כשיש. הכתובת בתבנית קבועה ורק הסיומת משתנה - זו הדרך
   * שמטא מיועדת לקישור דינמי. כתובת מלאה שמוזרקת דרך משתנה בגוף ההודעה
   * נראית למסנן כהסתרת יעד, ונדחית אוטומטית.
   */
  button?: { text: string; url: string; example: string };
  /** למה התבנית נחוצה - מוצג בממשק, לא נשלח למטא. */
  purpose: string;
  /** משתנה הסביבה שצריך להצביע עליה אחרי האישור. */
  envVar: string;
}

/**
 * שתי התבניות שהמערכת צריכה.
 *
 * מטא מחייבת שהטקסט לא יתחיל ולא יסתיים במשתנה, ודורשת דוגמה לכל משתנה
 * לצורך הבדיקה. שתי המגבלות האלה מעצבות את הניסוח כאן.
 *
 * זו פונקציה ולא קבוע, כי כתובת הכפתור נגזרת מהכתובת הציבורית של השירות.
 */
export function requiredTemplates(): TemplateSpec[] {
  const base = config.publicUrl;
  return [
    {
      name: "hug_alert",
      language: "he",
      category: "UTILITY",
      purpose: "התראה לנציג על פנייה שהוסלמה, או סיכום מרוכז.",
      envVar: "META_ALERT_TEMPLATE",
      body:
        'עדכון מתוכנית "חוג לכל ילד.ה" של עיריית קריית אונו.\n\n' +
        "נושא: {{1}}\n" +
        "טלפון הפונה: {{2}}\n\n" +
        "תמצית: {{3}}\n\n" +
        "הפרטים המלאים ממתינים בתיבת הנציג.",
      example: [
        "פנייה חדשה ממתינה לנציג",
        "972501234567",
        "הורה שאל האם אפשר לממש את השובר בשני חוגים שונים",
      ],
      ...(base
        ? {
            button: {
              text: "פתיחת תיבת הנציג",
              url: `${base}/admin/go/{{1}}`,
              example: `${base}/admin/go/12`,
            },
          }
        : {}),
    },
    {
      name: "hug_reply",
      language: "he",
      category: "UTILITY",
      purpose:
        "תשובת נציג להורה שכתב לפני יותר מ-24 שעות. בלעדיה השליחה נכשלת.",
      envVar: "META_REPLY_TEMPLATE",
      body:
        'הודעה מתוכנית "חוג לכל ילד.ה" של עיריית קריית אונו:\n\n' +
        "{{1}}\n\n" +
        "אפשר להשיב כאן ונמשיך מכאן.",
      example: [
        "בדקנו מול המתנ\"ס - נותר מקום בחוג, ואפשר להירשם דרך המזכירות",
      ],
    },
  ];
}

/** שולח תבנית לאישור מטא. האישור עצמו אינו מיידי. */
export async function createTemplate(spec: TemplateSpec): Promise<void> {
  if (!config.whatsapp.wabaId) {
    throw new Error("חסר META_WABA_ID - בלעדיו אי אפשר ליצור תבניות");
  }
  if (config.dryRun) {
    log.info("DRY_RUN - לא נשלחה תבנית לאישור", { name: spec.name });
    return;
  }
  await graph(`${base()}/${config.whatsapp.wabaId}/message_templates`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.whatsapp.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: spec.name,
      language: spec.language,
      category: spec.category,
      components: [
        {
          type: "BODY",
          text: spec.body,
          example: { body_text: [spec.example] },
        },
        ...(spec.button
          ? [
              {
                type: "BUTTONS",
                buttons: [
                  {
                    type: "URL",
                    text: spec.button.text,
                    url: spec.button.url,
                    example: [spec.button.example],
                  },
                ],
              },
            ]
          : []),
      ],
    }),
  });
}


/**
 * מחיקת תבנית. מטא אינה מתירה ליצור תבנית בשם שכבר קיים, גם כשהקיימת
 * נדחתה - ולכן הגשה מחדש היא מחיקה ויצירה.
 */
export async function deleteTemplate(name: string): Promise<void> {
  if (!config.whatsapp.wabaId) {
    throw new Error("חסר META_WABA_ID - בלעדיו אי אפשר למחוק תבניות");
  }
  if (config.dryRun) {
    log.info("DRY_RUN - לא נמחקה תבנית", { name });
    return;
  }
  await graph(
    `${base()}/${config.whatsapp.wabaId}/message_templates` +
      `?name=${encodeURIComponent(name)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${config.whatsapp.accessToken}` },
    },
  );
}
