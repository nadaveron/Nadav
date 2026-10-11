import type Anthropic from "@anthropic-ai/sdk";

/**
 * הכלים קיימים כדי שההחלטות של המודל יהיו מובנות ולא ניחוש מתוך טקסט.
 * כשהמודל מחליט להסלים, אנחנו רוצים אירוע מתועד עם סיבה - לא לחפש
 * ביטויים כמו "אעביר אותך לנציג" בתוך התשובה.
 *
 * הסדר קבוע: רשימת הכלים היא חלק מקידומת המטמון, ושינוי סדר מבטל אותו.
 */
export const tools: Anthropic.Beta.BetaTool[] = [
  {
    name: "refer_to_operator",
    description:
      "הפניה למפעיל חוג ספציפי, כששאלה נוגעת לתפעול ולא למדיניות התוכנית: " +
      "שעות פעילות, מיקום, זהות המדריך, רשימת המתנה או החלפת קבוצה. " +
      "אחרי הקריאה, מסור להורה את כתובת המייל או הקישור של המפעיל מתוך " +
      "המסמכים - לא את הטלפון, אלא אם ביקש אותו או שאין ערוץ אחר.",
    input_schema: {
      type: "object",
      properties: {
        operator: {
          type: "string",
          enum: ["מתנס", "קונסרבטוריון", "בריכה", "אגף הספורט"],
          description: "הגוף שאחראי על החוג שעליו נשאלה השאלה",
        },
        topic: {
          type: "string",
          description: "נושא הפנייה במשפט אחד, בלי פרטים מזהים",
        },
      },
      required: ["operator", "topic"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "escalate_to_human",
    description:
      "העברת השיחה לנציג אנושי. השתמש בכלי הזה רק במקרים המנויים במסמך " +
      "ההסלמה, או כשהתשובה באמת אינה נמצאת במסמכים. " +
      "אם ענית להורה מתוך המסמכים - אל תקרא לכלי הזה בנוסף: הנציג הוא " +
      "אדם אחד, והסלמה מיותרת מעכבת הורה שכבר קיבל תשובה.",
    input_schema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          enum: [
            "בקשה מפורשת לנציג",
            "תלונה או חוסר שביעות רצון",
            "בקשה חריגה שאינה בתקנון",
            "נושא כספי או חיוב",
            "מצוקה אישית",
            "אין לי את המידע",
            "שאלה משפטית או בקשה רשמית",
          ],
        },
        summary: {
          type: "string",
          description:
            "סיכום הפנייה לנציג במשפט או שניים, בלי תעודת זהות ובלי פרטי תשלום",
        },
      },
      required: ["reason", "summary"],
      additionalProperties: false,
    },
    strict: true,
  },
];

export interface ToolDecision {
  referral?: { operator: string; topic: string };
  escalation?: { reason: string; summary: string };
}
