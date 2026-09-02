import crypto from "node:crypto";
import { config } from "../config.ts";
import { log } from "../logger.ts";
import type { InboundMessage, WhatsAppProvider } from "./provider.ts";

/** מגבלת אורך של הודעת טקסט בווטסאפ. */
const MAX_BODY = 4096;

interface MetaWebhookBody {
  object?: string;
  entry?: {
    changes?: {
      value?: {
        contacts?: { wa_id?: string; profile?: { name?: string } }[];
        messages?: {
          id?: string;
          from?: string;
          timestamp?: string;
          type?: string;
          text?: { body?: string };
        }[];
      };
    }[];
  }[];
}

export class MetaCloudProvider implements WhatsAppProvider {
  readonly name = "meta";

  private get baseUrl(): string {
    return `https://graph.facebook.com/${config.whatsapp.graphVersion}/${config.whatsapp.phoneNumberId}`;
  }

  /**
   * מטא חותמת כל webhook עם ה-App Secret. בלי האימות הזה כל מי שמכיר את
   * כתובת השרת יכול להזריק הודעות מזויפות ולגרום לבוט לענות בשם העירייה.
   */
  verifySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    if (!signatureHeader?.startsWith("sha256=")) return false;
    const expected = crypto
      .createHmac("sha256", config.whatsapp.appSecret)
      .update(rawBody)
      .digest("hex");
    const received = signatureHeader.slice("sha256=".length);
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(received, "utf8");
    // timingSafeEqual דורש אורך זהה, ונופל אחרת - לכן בודקים קודם.
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  parseWebhook(body: unknown): InboundMessage[] {
    const payload = body as MetaWebhookBody;
    const out: InboundMessage[] = [];

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value?.messages) continue;

        const nameByWaId = new Map<string, string>();
        for (const c of value.contacts ?? []) {
          if (c.wa_id && c.profile?.name) nameByWaId.set(c.wa_id, c.profile.name);
        }

        for (const m of value.messages) {
          if (!m.id || !m.from) continue;
          const isText = m.type === "text" && typeof m.text?.body === "string";
          out.push({
            id: m.id,
            from: m.from.replace(/\D/g, ""),
            profileName: nameByWaId.get(m.from),
            text: isText ? (m.text?.body ?? "") : "",
            kind: isText ? "text" : "unsupported",
            timestamp: m.timestamp ? new Date(Number(m.timestamp) * 1000) : new Date(),
          });
        }
      }
    }
    return out;
  }

  async sendText(to: string, body: string): Promise<void> {
    // ווטסאפ חותכת הודעות ארוכות מדי בלי להתריע, לכן מפצלים בעצמנו.
    for (const chunk of splitBody(body)) {
      await this.post({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body: chunk },
      });
    }
  }

  async markRead(messageId: string): Promise<void> {
    try {
      await this.post({
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
      });
    } catch (err) {
      // סימון כנקרא הוא נוחות בלבד - כישלון שלו לא אמור להפיל את הטיפול.
      log.warn("סימון הודעה כנקראה נכשל", { error: String(err) });
    }
  }

  private async post(payload: Record<string, unknown>): Promise<void> {
    if (config.dryRun) {
      log.info("DRY_RUN - לא נשלחה בקשה למטא", { type: payload.type ?? payload.status });
      return;
    }

    const res = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.whatsapp.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Meta Graph API החזיר ${res.status}: ${detail.slice(0, 400)}`);
    }
  }
}

/** מפצל לפי שורות כדי לא לחתוך באמצע משפט. */
export function splitBody(body: string, limit = MAX_BODY): string[] {
  if (body.length <= limit) return [body];
  const parts: string[] = [];
  let current = "";
  for (const line of body.split("\n")) {
    if (current.length + line.length + 1 > limit) {
      if (current) parts.push(current);
      // שורה בודדת ארוכה מהמגבלה - אין ברירה אלא לחתוך אותה.
      if (line.length > limit) {
        for (let i = 0; i < line.length; i += limit) parts.push(line.slice(i, i + limit));
        current = "";
        continue;
      }
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) parts.push(current);
  return parts;
}
