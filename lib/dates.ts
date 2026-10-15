import * as chrono from "chrono-node";
import { format, isBefore, isToday, isTomorrow, startOfDay } from "date-fns";

export const DEFAULT_HOUR = 9;

// chrono doesn't read a bare ordinal ("on the 20th"), which is how people say it here.
// Treat it as the next 20th, this month or next.
const parser = chrono.en.GB.clone();
parser.parsers.push({
  pattern: () =>
    /\b(?:the\s+)?([1-9]|[12]\d|3[01])(?:st|nd|rd|th)\b(?!\s+(?:of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))/i,
  extract: (context, match) => {
    const day = Number(match[1]);
    const ref = context.refDate;
    let month = ref.getMonth();
    let year = ref.getFullYear();
    if (day < ref.getDate()) {
      month = (month + 1) % 12;
      if (month === 0) year += 1;
    }
    return { day, month: month + 1, year };
  },
});

const LONE_ORDINAL = /^(the\s+)?\d{1,2}(st|nd|rd|th)$/i;

// Words typed into the date field ("next Tuesday 3pm") → a date for the pickers.
// Only the date field is parsed; the reminder note never is.
export function parseDateText(text: string, now = new Date()): { date: Date; hasTime: boolean } | null {
  // Prefer a real date over a lone ordinal ("2nd … tomorrow" → tomorrow).
  const hits = parser.parse(text, now, { forwardDate: true });
  const hit = hits.find((h) => !LONE_ORDINAL.test(h.text)) ?? hits[0];
  if (!hit) return null;
  return { date: hit.start.date(), hasTime: hit.start.isCertain("hour") };
}

// The pickers and the summary line both use these, so they always agree.
export const DATE_FORMAT = "EEE d MMM yyyy";
export const TIME_FORMAT = "HH:mm";

export function formatShort(iso: string) {
  const d = new Date(iso);
  if (isToday(d)) return "Today";
  if (isTomorrow(d)) return "Tomorrow";
  return format(d, "EEE d MMM");
}

export function isOverdue(iso: string) {
  return isBefore(new Date(iso), startOfDay(new Date()));
}
