export type KeywordMatch = 'opt_out' | 'opt_in' | 'said_no';

export const OPT_OUT_WORDS = [
  'stop',
  'stopall',
  'stop all',
  'unsubscribe',
  'end',
  'quit',
  'stop texts',
  'stop messages',
] as const;

export const OPT_IN_WORDS = ['start', 'unstop'] as const;

export const SAID_NO_WORDS = [
  'no',
  'nope',
  'no thanks',
  'no thank you',
  'not this time',
  'not this week',
  'cancel',
  'cancel please',
  'please cancel',
  'cancel it',
  'cancel this one',
  'no not this time',
] as const;

/** Lower-case, trim, strip everything except letters and spaces, collapse spaces. */
export function normaliseReply(body: string): string {
  return body
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function matchKeyword(body: string): KeywordMatch | null {
  const normalised = normaliseReply(body);
  if (!normalised) return null;
  if ((OPT_OUT_WORDS as readonly string[]).includes(normalised)) return 'opt_out';
  if ((OPT_IN_WORDS as readonly string[]).includes(normalised)) return 'opt_in';
  if ((SAID_NO_WORDS as readonly string[]).includes(normalised)) return 'said_no';
  return null;
}
