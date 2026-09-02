import { generateKeys } from "../privacy/crypto.ts";

const { encryptionKey, pepper } = generateKeys();

console.log(`
נוצרו מפתחות חדשים. העתיקו אותם לקובץ .env (או ל-Secret Manager של הענן):

DATA_ENCRYPTION_KEY=${encryptionKey}
PHONE_HASH_PEPPER=${pepper}

⚠  אזהרה: אלה המפתחות היחידים לכל היסטוריית השיחות.
   - אם הם אובדים, אי אפשר לשחזר אף שיחה. אין דלת אחורית.
   - אם הם דולפים, מי שמשיג עותק של מסד הנתונים יכול לפענח הכול.
   שמרו עותק במנהל הסיסמאות הארגוני, אצל שני אנשים לפחות,
   ואל תשמרו אותם באותו מקום שבו נשמרים הגיבויים של מסד הנתונים.
`);
