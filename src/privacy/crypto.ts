import crypto from "node:crypto";
import { config } from "../config.ts";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function key(): Buffer {
  const k = Buffer.from(config.crypto.encryptionKey, "base64");
  if (k.length !== 32) {
    throw new Error(
      "DATA_ENCRYPTION_KEY חייב להיות 32 בתים בקידוד base64. הריצו `npm run keys`.",
    );
  }
  return k;
}

/**
 * הצפנה סימטרית מאומתת. הפורמט: base64( iv || tag || ciphertext ).
 * כל שדה מוצפן בנפרד, כך שגם מי שמשיג עותק של קובץ ה-DB לא רואה דבר.
 */
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
}

export function decrypt(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  if (buf.length < IV_LEN + TAG_LEN) throw new Error("מטען מוצפן פגום");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const data = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/**
 * מזהה מדומה יציב לפונה. משמש כמפתח בכל הטבלאות, בלוגים ובדוחות הפנימיים,
 * כדי שמספר הטלפון עצמו יופיע רק במקום אחד - השדה המוצפן.
 * ה-pepper הוא סוד מקומי: בלעדיו אי אפשר לבנות טבלת קשת ולשחזר מספרים.
 */
export function pseudonym(phone: string): string {
  return crypto
    .createHmac("sha256", config.crypto.phonePepper)
    .update(phone.replace(/\D/g, ""))
    .digest("hex")
    .slice(0, 32);
}

/** ייצור מפתחות חדשים - עבור `npm run keys`. */
export function generateKeys(): { encryptionKey: string; pepper: string } {
  return {
    encryptionKey: crypto.randomBytes(32).toString("base64"),
    pepper: crypto.randomBytes(32).toString("base64"),
  };
}
