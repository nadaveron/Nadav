/**
 * שכבת מתאם לספק הווטסאפ. כל הקוד שמעליה מדבר רק בטיפוסים האלה, כך
 * שמעבר מ-Meta Cloud API ל-Twilio או לספק אחר הוא הוספת קובץ אחד
 * ושינוי משתנה סביבה - בלי לגעת בלוגיקת הבוט.
 */

export interface InboundMessage {
  /** מזהה ייחודי של ההודעה אצל הספק - משמש למניעת טיפול כפול. */
  id: string;
  /** מספר הטלפון של הפונה, ספרות בלבד בפורמט בינלאומי. */
  from: string;
  /** השם שהפונה הגדיר בפרופיל הווטסאפ שלו, אם נמסר. */
  profileName?: string;
  text: string;
  /** סוג ההודעה המקורי - כדי לענות אחרת על תמונה או הקלטה. */
  kind: "text" | "unsupported";
  timestamp: Date;
}

export interface WhatsAppProvider {
  readonly name: string;
  sendText(to: string, body: string): Promise<void>;
  markRead(messageId: string): Promise<void>;
  /** מאמת שהבקשה אכן הגיעה מהספק ולא מגורם חיצוני. */
  verifySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean;
  /** מתרגם את מבנה ה-webhook של הספק לטיפוס האחיד. */
  parseWebhook(body: unknown): InboundMessage[];
}
