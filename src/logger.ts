import { config } from "./config.ts";

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 } as const;
type Level = keyof typeof LEVELS;

const threshold = LEVELS[(config.logLevel as Level) in LEVELS ? (config.logLevel as Level) : "info"];

/**
 * לוג מובנה. חשוב: אף פונקציה כאן לא אמורה לקבל טקסט הודעה גולמי או מספר
 * טלפון. מזהים בלוג הם תמיד ה-hash המדומה של הפונה, לעולם לא המספר עצמו.
 */
function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (LEVELS[level] > threshold) return;
  const line = { ts: new Date().toISOString(), level, msg, ...fields };
  const out = level === "error" || level === "warn" ? console.error : console.log;
  out(JSON.stringify(line));
}

export const log = {
  error: (m: string, f?: Record<string, unknown>) => emit("error", m, f),
  warn: (m: string, f?: Record<string, unknown>) => emit("warn", m, f),
  info: (m: string, f?: Record<string, unknown>) => emit("info", m, f),
  debug: (m: string, f?: Record<string, unknown>) => emit("debug", m, f),
};
