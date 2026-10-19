import { countSegments, toGsm7 } from '@/lib/messaging/gsm';

/** Editable customer texts. Chasers, skip/move and payment thanks stay fixed. */
export const WORDING_KEYS = [
  'reminder',
  'visit_done_to_pay',
  'visit_done_paid_now',
  'visit_done_paid_credit',
  'visit_done_invoice',
  'visit_done_direct_debit',
] as const;

export type WordingKey = (typeof WORDING_KEYS)[number];

export type MessageWording = Record<WordingKey, string | null>;

export function emptyMessageWording(): MessageWording {
  return {
    reminder: null,
    visit_done_to_pay: null,
    visit_done_paid_now: null,
    visit_done_paid_credit: null,
    visit_done_invoice: null,
    visit_done_direct_debit: null,
  };
}

export function isWordingKey(value: string): value is WordingKey {
  return (WORDING_KEYS as readonly string[]).includes(value);
}

type WordingSpec = {
  key: WordingKey;
  title: string;
  /** Tokens that must appear, written exactly like {date}. */
  required: readonly string[];
  optional: readonly string[];
  /** Literal text that must appear, such as Reply NO. */
  requiredPhrase: string | null;
  instructions: string;
  /** What the example underneath is using. */
  exampleNote: string;
};

export const WORDING_SPECS: readonly WordingSpec[] = [
  {
    key: 'reminder',
    title: 'Visit reminder',
    required: ['business', 'job'],
    optional: ['address', 'date', 'time', 'phone'],
    requiredPhrase: 'Reply NO',
    instructions: `Keep these in the message, written exactly like this:
{business} {job} Reply NO

{date} is the day, such as Thu 2 Oct. {address}, {date}, {time} and {phone} can come out. {phone} is your number.

Reply NO stays, because a customer who says nothing is still expecting the visit. Do not write reply YES.

The first text to a customer also adds "Reply STOP to opt out." The example is that first text. If keeping the job name would take a second text, the standard message leaves the job name out. Your own wording keeps what you wrote, up to 2 texts.`,
    exampleNote: '12 Elm Rd, Thu 2 Oct, around 9:30am. First text to a customer.',
  },
  {
    key: 'visit_done_to_pay',
    title: 'Visit done, still to pay',
    required: ['business', 'job', 'amount', 'pay_link', 'phone'],
    optional: ['address', 'date'],
    requiredPhrase: null,
    instructions: `Keep these in the message, written exactly like this:
{business} {job} {amount} {pay_link} {phone}

{address} and {date} can come out. {date} is "today", or "on Thu 2 Oct" when the visit was another day. Write it as: done {date}

{amount} is what they owe. {pay_link} is the link to pay. {phone} is your number.

The example is the text that is sent. A long pay link makes the standard message say "visit" instead of the job and the street, so it stays one text. Your own wording keeps what you wrote, up to 2 texts.`,
    exampleNote: 'Done today, £15 still to pay, with a full pay link.',
  },
  {
    key: 'visit_done_paid_now',
    title: 'Visit done, paid cash or cheque',
    required: ['business', 'job', 'amount', 'phone'],
    optional: ['address', 'date', 'method', 'credit'],
    requiredPhrase: null,
    instructions: `Keep these in the message, written exactly like this:
{business} {job} {amount} {phone}

{address} and {date} can come out. {date} is "today", or "on Thu 2 Oct" when the visit was another day. Write it as: done {date}

{method} is cash or cheque. {credit} is the line about money left on their account, and it is left out when there is none. Both can come out. {phone} is your number.`,
    exampleNote: '12 Elm Rd, window clean, £15 cash, £3 still on their account.',
  },
  {
    key: 'visit_done_paid_credit',
    title: 'Visit done, paid from credit',
    required: ['business', 'job', 'phone'],
    optional: ['address', 'date', 'credit'],
    requiredPhrase: null,
    instructions: `Keep these in the message, written exactly like this:
{business} {job} {phone}

{address} and {date} can come out. {date} is "today", or "on Thu 2 Oct" when the visit was another day. Write it as: done {date}

{credit} is "(£3 left)" when they still have credit, and it is left out when they do not. It can come out. {phone} is your number.`,
    exampleNote: '12 Elm Rd, window clean, paid from credit, £3 left.',
  },
  {
    key: 'visit_done_invoice',
    title: 'Visit done, invoice',
    required: ['business', 'job', 'invoice', 'amount', 'invoice_link', 'phone'],
    optional: ['address', 'date'],
    requiredPhrase: null,
    instructions: `Keep these in the message, written exactly like this:
{business} {job} {invoice} {amount} {invoice_link} {phone}

{address} and {date} can come out. {date} is "today", or "on Thu 2 Oct" when the visit was another day. Write it as: done {date}

{invoice} is the invoice number. {invoice_link} is the link. {phone} is your number.`,
    exampleNote: '12 Elm Rd, window clean, invoice INV-0042 for £15.',
  },
  {
    key: 'visit_done_direct_debit',
    title: 'Visit done, Direct Debit',
    required: ['business', 'job', 'amount', 'collect_on', 'phone'],
    optional: ['address', 'date'],
    requiredPhrase: null,
    instructions: `Keep these in the message, written exactly like this:
{business} {job} {amount} {collect_on} {phone}

{address} and {date} can come out. {date} is "today", or "on Thu 2 Oct" when the visit was another day. Write it as: done {date}

{amount} is the amount, such as £15.00. {collect_on} is the day it can be taken, such as Tue 7 Oct. {phone} is your number.`,
    exampleNote: '12 Elm Rd, window clean, £15.00 by Direct Debit on or after Tue 7 Oct.',
  },
];

const TOKEN_LABELS: Record<string, string> = {
  business: 'Business',
  address: 'Address',
  date: 'Date',
  job: 'Job',
  time: 'Time',
  phone: 'Phone',
  amount: 'Amount',
  pay_link: 'Pay link',
  method: 'Cash or cheque',
  credit: 'Credit left',
  invoice: 'Invoice number',
  invoice_link: 'Invoice link',
  collect_on: 'Collection day',
};

export function wordingTokenLabel(token: string): string {
  return TOKEN_LABELS[token] ?? token;
}

/** Tokens for this message, required first. */
export function wordingTokens(key: WordingKey): { token: string; required: boolean }[] {
  const spec = wordingSpec(key);
  return [
    ...spec.required.map((token) => ({ token, required: true })),
    ...spec.optional.map((token) => ({ token, required: false })),
  ];
}

/**
 * Insert {token} at the caret. An unfinished `{da` is replaced.
 * A space is added so it doesn't stick to the words around it.
 */
export function insertWordingToken(
  value: string,
  index: number,
  token: string,
): { value: string; caret: number } {
  const at = Math.max(0, Math.min(index, value.length));
  const before = value.slice(0, at);
  const open = /\{[a-z0-9_]*$/.exec(before);
  const start = open ? at - open[0].length : at;
  const prefix = value.slice(0, start);
  const rest = value.slice(at);
  const piece = `{${token}}`;
  const lead = prefix.length > 0 && !/\s$/.test(prefix) ? ' ' : '';
  const trail = rest.length > 0 && !/^[\s,.]/.test(rest) ? ' ' : '';
  const insertion = `${lead}${piece}${trail}`;
  return {
    value: `${prefix}${insertion}${rest}`,
    caret: prefix.length + insertion.length,
  };
}

/** The letters after an unclosed `{` at the caret. Null when they aren't writing a piece. */
export function wordingTokenQuery(beforeCaret: string): string | null {
  const match = /\{([a-z0-9_]*)$/.exec(beforeCaret);
  return match ? match[1] : null;
}

/** Pieces whose name or label starts with what they've typed. */
export function matchingWordingTokens(query: string, tokens: readonly string[]): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...tokens];
  return tokens.filter((token) => {
    if (token.startsWith(q)) return true;
    const label = wordingTokenLabel(token).toLowerCase();
    if (label.startsWith(q)) return true;
    return label.split(' ').some((word) => word.startsWith(q));
  });
}

const SPEC_BY_KEY = new Map(WORDING_SPECS.map((spec) => [spec.key, spec]));

export function wordingSpec(key: WordingKey): WordingSpec {
  const spec = SPEC_BY_KEY.get(key);
  if (!spec) throw new Error(`wordingSpec: unknown key ${key}`);
  return spec;
}

export type WordingCatalogueItem = {
  key: WordingKey;
  title: string;
  instructions: string;
  exampleNote: string;
  standard: string;
  pieces: { token: string; label: string; required: boolean }[];
};

/** What the phone shows. The app does not keep its own copy of these sentences. */
export function wordingCatalogue(): WordingCatalogueItem[] {
  return WORDING_SPECS.map((spec) => ({
    key: spec.key,
    title: spec.title,
    instructions: spec.instructions,
    exampleNote: spec.exampleNote,
    standard: STANDARD_WORDING[spec.key],
    pieces: wordingTokens(spec.key).map((piece) => ({
      token: piece.token,
      label: wordingTokenLabel(piece.token),
      required: piece.required,
    })),
  }));
}

/** The sentence in the box before they change anything. Null in storage means this. */
export const STANDARD_WORDING: Record<WordingKey, string> = {
  reminder:
    "{business}: we're due at {address} on {date} {time} for your {job}. Reply NO if that's a problem. Questions? Call {phone}",
  visit_done_to_pay:
    '{business}: your {job} at {address} was done {date}. {amount} to pay: {pay_link} Thanks! Questions? Call {phone}',
  visit_done_paid_now:
    '{business}: your {job} at {address} was done {date}. Thanks for the {amount} {method}! {credit}Questions? Call {phone}',
  visit_done_paid_credit:
    '{business}: your {job} at {address} was done {date}, paid from your credit{credit}. Questions? Call {phone}',
  visit_done_invoice:
    '{business}: your {job} at {address} was done {date}. Invoice {invoice} for {amount}: {invoice_link} Questions? Call {phone}',
  visit_done_direct_debit:
    '{business}: your {job} at {address} was done {date}. {amount} will be collected by Direct Debit on or after {collect_on}. Questions? Call {phone}',
};

const TOKEN_RE = /\{([^{}]*)\}/g;

/** null when the sentence is allowed to be stored. Segment length is checked separately. */
export function checkWordingShape(key: WordingKey, template: string): string | null {
  const text = template.trim();
  if (text.length > 500) return 'Keep it to 500 characters.';
  const spec = wordingSpec(key);
  const opens = (text.match(/\{/g) ?? []).length;
  const closes = (text.match(/\}/g) ?? []).length;
  if (opens !== closes) return 'Each piece needs a { and a }.';

  const found: string[] = [];
  for (const match of text.matchAll(TOKEN_RE)) {
    found.push(match[1] ?? '');
  }
  if (found.some((token) => token.length === 0)) {
    return 'Write pieces like {date}, with the brackets.';
  }

  const allowed = new Set<string>([...spec.required, ...spec.optional]);
  const unknown = found.find((token) => !allowed.has(token));
  if (unknown) {
    return `Take out {${unknown}}. Only the pieces in the instructions can be used.`;
  }

  const missing = spec.required.filter((token) => !text.includes(`{${token}}`));
  const missingPhrase =
    spec.requiredPhrase && !text.includes(spec.requiredPhrase) ? [spec.requiredPhrase] : [];
  if (missing.length > 0 || missingPhrase.length > 0) {
    const list = [...missing.map((token) => `{${token}}`), ...missingPhrase].join(' ');
    return `Put these back: ${list}`;
  }

  if (key === 'reminder' && /reply\s+yes/i.test(text)) {
    return 'Do not write reply YES. A customer who says nothing is still expecting the visit.';
  }
  return null;
}

function fillTokens(template: string, values: Record<string, string>): string {
  let out = template;
  if (!values.phone) {
    out = out.replace(/\s*Questions\?\s*Call\s*\{phone\}/g, '');
  }
  for (const key of Object.keys(values)) {
    out = out.split(`{${key}}`).join(values[key] ?? '');
  }
  out = out.replace(/\{[a-z0-9_]+\}/g, '');
  return out;
}

function finishText(raw: string, appendStop: boolean): string {
  let out = toGsm7(raw).replace(/[ \t]{2,}/g, ' ').trim();
  out = out.replace(/\s*Reply STOP to opt out\./g, '').trim();
  if (appendStop) out = `${out} Reply STOP to opt out.`;
  return out;
}

export function renderWording(opts: {
  template: string;
  businessName: string;
  shortenName: (name: string) => string;
  shrinkName: (name: string) => string;
  valuesFor: (business: string) => Record<string, string>;
  appendStop?: boolean;
  maxSegments: 1 | 2;
}): { text: string; length: number; segments: number; fitted: boolean } {
  let biz = opts.shortenName(opts.businessName);
  let previous = '';
  let last = finishText('', opts.appendStop === true);
  for (;;) {
    const text = finishText(
      fillTokens(opts.template, opts.valuesFor(biz)),
      opts.appendStop === true,
    );
    const counted = countSegments(text);
    last = text;
    if (counted.segments <= opts.maxSegments && counted.segments >= 1) {
      return { text, length: counted.length, segments: counted.segments, fitted: true };
    }
    if (text === previous) break;
    previous = text;
    const next = opts.shrinkName(biz);
    if (next === biz) break;
    biz = next;
  }
  const counted = countSegments(last);
  return {
    text: last,
    length: counted.length,
    segments: counted.segments,
    fitted: counted.segments >= 1 && counted.segments <= opts.maxSegments,
  };
}
