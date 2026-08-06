export type JobLength = 'half_day' | 'full_day';

/** Time ranges at or above this many hours are treated as a full day. */
export const FULL_DAY_MIN_HOURS = 6;

const HALF_DAY_LABEL = /\b(half[\s_-]?day|hd|morning)\b/i;
const FULL_DAY_LABEL = /\b(full[\s_-]?day|fd|all[\s_-]?day)\b/i;

/**
 * Narrower label set for scanning free text (e.g. a job description) rather
 * than a deliberately-mapped column. Short abbreviations like "HD"/"FD" and
 * "morning" are too likely to appear as substrings of unrelated words or
 * phrases in prose (e.g. "Replace HD CCTV camera") to trust there.
 */
const HALF_DAY_PHRASE = /\b(half[\s_-]?day)\b/i;
const FULL_DAY_PHRASE = /\b(full[\s_-]?day|all[\s_-]?day)\b/i;

const RANGE_SEPARATOR = /^(.+?)\s*(?:-|–|—|to)\s*(.+)$/i;
const TIME_TOKEN = /^(\d{1,2})(?::([0-5]\d))?\s*(am|pm)?$/i;

/**
 * A bare hour with no colon and no am/pm (e.g. "9" in "9-5") is genuinely
 * ambiguous — could be 9am or 9pm. Rejecting it rather than guessing keeps
 * this normalizer honest with "if unknown, do not guess"; only "08:30" or
 * "9am"-style unambiguous tokens are parsed.
 */
function parseTimeToken(token: string): number | null {
  const match = token.trim().match(TIME_TOKEN);
  if (!match) return null;

  const hasMinutes = match[2] !== undefined;
  const meridiem = match[3]?.toLowerCase();
  if (!hasMinutes && !meridiem) return null;

  let hour = parseInt(match[1], 10);
  const minute = hasMinutes ? parseInt(match[2], 10) : 0;

  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = hour === 12 ? (meridiem === 'am' ? 0 : 12) : meridiem === 'pm' ? hour + 12 : hour;
  } else if (hour > 23) {
    return null;
  }

  return hour + minute / 60;
}

function parseRangeHours(raw: string): number | null {
  const match = raw.trim().match(RANGE_SEPARATOR);
  if (!match) return null;

  const start = parseTimeToken(match[1]);
  const end = parseTimeToken(match[2]);
  if (start == null || end == null) return null;

  let duration = end - start;
  if (duration <= 0) duration += 24; // overnight range, e.g. "22:00-02:00"
  if (duration <= 0 || duration > 24) return null;

  return duration;
}

function classify(value: string, halfPattern: RegExp, fullPattern: RegExp): JobLength | null {
  if (halfPattern.test(value)) return 'half_day';
  if (fullPattern.test(value)) return 'full_day';

  const hours = parseRangeHours(value);
  if (hours != null) {
    return hours >= FULL_DAY_MIN_HOURS ? 'full_day' : 'half_day';
  }

  return null;
}

/**
 * Normalizes a raw CSV cell into a job length. Deterministic, no AI —
 * mirrors toPriority()'s role for the priority field. Returns null rather
 * than guessing when the input is empty, a single time with no range, or
 * doesn't match any known pattern. Use this for a deliberately-mapped
 * column; use normalizeJobLengthFromText for scanning free text.
 */
export function normalizeJobLength(raw: string | null | undefined): JobLength | null {
  const value = raw?.trim();
  if (!value) return null;
  return classify(value, HALF_DAY_LABEL, FULL_DAY_LABEL);
}

/**
 * Same as normalizeJobLength but for free text (e.g. a job description) where
 * the value wasn't deliberately mapped to job_length. Only matches full
 * "half day"/"full day"/"all day" phrases — not the "HD"/"FD"/"morning"
 * abbreviations, which are too likely to be false positives in prose.
 */
export function normalizeJobLengthFromText(raw: string | null | undefined): JobLength | null {
  const value = raw?.trim();
  if (!value) return null;
  return classify(value, HALF_DAY_PHRASE, FULL_DAY_PHRASE);
}
