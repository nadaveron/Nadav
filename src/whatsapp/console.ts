import { config } from "../config.ts";
import type { InboundMessage, WhatsAppProvider } from "./provider.ts";

/**
 * ספק מדומה שמדפיס למסך במקום לשלוח לווטסאפ.
 *
 * הוא ממש את אותו ממשק כמו המימוש של מטא, ולכן `handleInbound` רץ דרכו
 * במסלול זהה לחלוטין לייצור - כולל ניקוי מזהים, שמירה מוצפנת, זיהוי
 * כפילויות, קריאה למודל, הסלמה והתראה לנציג. מה שנבדק כאן הוא מה שירוץ
 * מול הורים אמיתיים, ולא קירוב שלו.
 */
export class ConsoleProvider implements WhatsAppProvider {
  readonly name = "console";

  async sendText(to: string, body: string): Promise<void> {
    const isManager = to === config.handoff.managerPhone;
    if (isManager) {
      console.log(`\n\x1b[33m🔔 התראה לנציג:\x1b[0m\n${indent(body)}\n`);
    } else {
      console.log(`\n\x1b[36m🤖 הבוט:\x1b[0m\n${indent(body)}\n`);
    }
  }

  async sendTemplate(_to: string, name: string, _lang: string, params: string[]): Promise<void> {
    console.log(`\n\x1b[33m🔔 התראה לנציג (תבנית "${name}"):\x1b[0m\n${indent(params.join("\n"))}\n`);
  }

  async markRead(): Promise<void> {}

  verifySignature(): boolean {
    return true;
  }

  parseWebhook(): InboundMessage[] {
    return [];
  }
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((l) => `   ${l}`)
    .join("\n");
}
