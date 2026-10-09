import { countSegments, toGsm7 } from '@/lib/messaging/gsm';
import {
  renderWording,
  STANDARD_WORDING,
  checkWordingShape,
  type WordingKey,
} from '@/lib/messaging/wording';
import { formatGbp } from '@/lib/money/pence';
import { formatUkPhoneDisplay } from '@/lib/utils/phone';

export type SmsBrand = { businessName: string; contactPhone: string | null };

export type SmsPiece = {
  text: string;
  drop?: number;
  /** No space before this piece. Optional so `{ text, drop }` still works. */
  glue?: 'space' | 'none';
};

const BUSINESS_NAME_MAX = 30;
const ADDRESS_MAX = 28;
const SERVICE_LABEL_MAX = 30;

function trimAtWord(value: string, max: number): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if ([...trimmed].length <= max) return trimmed;
  const cut = [...trimmed].slice(0, max).join('');
  const sp = cut.lastIndexOf(' ');
  return (sp > 0 ? cut.slice(0, sp) : cut).trim();
}

/** ≤ 30 chars, trimmed at a word boundary, no ellipsis. */
export function shortBusinessName(name: string): string {
  return trimAtWord(name, BUSINESS_NAME_MAX);
}

/** First comma-separated part, ≤ 28 chars at a word boundary. */
export function shortAddress(address: string): string {
  const first = address.split(',')[0] ?? '';
  return trimAtWord(first, ADDRESS_MAX);
}

/** ['Window clean','Gutters'] -> 'window clean and gutters'; 3+ -> 'a, b and c'; > 30 chars -> 'visit'. */
export function serviceLabel(titles: string[]): string {
  const cleaned = titles.map((title) => title.trim().toLowerCase()).filter(Boolean);
  let phrase: string;
  if (cleaned.length === 0) phrase = 'visit';
  else if (cleaned.length === 1) phrase = cleaned[0]!;
  else if (cleaned.length === 2) phrase = `${cleaned[0]} and ${cleaned[1]}`;
  else phrase = `${cleaned.slice(0, -1).join(', ')} and ${cleaned[cleaned.length - 1]}`;
  return [...phrase].length > SERVICE_LABEL_MAX ? 'visit' : phrase;
}

/** '09:30' -> 'around 9:30am', '14:00' -> 'around 2pm', null/invalid -> null. */
export function timeLabel(hhmm: string | null | undefined): string | null {
  if (hhmm == null) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  const suffix = hours < 12 ? 'am' : 'pm';
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  if (minutes === 0) return `around ${h12}${suffix}`;
  return `around ${h12}:${String(minutes).padStart(2, '0')}${suffix}`;
}

function renderPieces(pieces: SmsPiece[]): string {
  let out = '';
  for (const piece of pieces) {
    if (!piece.text) continue;
    if (!out) {
      out = piece.text;
      continue;
    }
    out += piece.glue === 'none' ? piece.text : ` ${piece.text}`;
  }
  return toGsm7(out);
}

type FitOpts = {
  maxSegments: 1 | 2;
  /** When set, dropping this piece keeps `fallback` instead of removing it. */
  fallbackFor?: (piece: SmsPiece) => string | null;
};

function fitPieces(pieces: SmsPiece[], opts: FitOpts): string | null {
  const current = pieces.filter((piece) => piece.text.length > 0);
  for (;;) {
    const text = renderPieces(current);
    if (countSegments(text).segments <= opts.maxSegments) return text;
    let best = -1;
    let bestDrop = Infinity;
    for (let i = 0; i < current.length; i++) {
      const drop = current[i]?.drop;
      if (drop == null) continue;
      if (drop < bestDrop) {
        bestDrop = drop;
        best = i;
      }
    }
    if (best < 0) return null;
    const piece = current[best]!;
    const fallback = opts.fallbackFor?.(piece) ?? null;
    if (fallback) {
      current[best] = { text: fallback };
      continue;
    }
    current.splice(best, 1);
  }
}

/** Joins pieces, applies toGsm7, then drops optional pieces (lowest `drop` first). */
export function fitSms(pieces: SmsPiece[], maxSegments: 1 | 2 = 1): string {
  const text = fitPieces(pieces, { maxSegments });
  if (text == null) {
    throw new Error(
      'fitSms: message exceeds max segments after dropping optional pieces',
    );
  }
  return text;
}

function shrinkBusinessName(name: string): string {
  const sp = name.lastIndexOf(' ');
  if (sp > 0) return name.slice(0, sp).trim();
  if ([...name].length <= 1) return name;
  return [...name].slice(0, -1).join('');
}

/**
 * fitSms, then if the required text is still over one segment, drop words
 * from the end of the business name and try again. A 30-character name plus
 * the stage-1 chaser and a 65-character pay link is 168 characters.
 * With maxSegments 2, one segment is still tried first at each name length.
 */
function fitBranded(
  businessName: string,
  build: (biz: string) => SmsPiece[],
  fallbackFor?: (piece: SmsPiece) => string | null,
  maxSegments: 1 | 2 = 1,
): string {
  let biz = shortBusinessName(businessName);
  for (;;) {
    const pieces = build(biz);
    const text =
      fitPieces(pieces, { maxSegments: 1, fallbackFor }) ??
      (maxSegments === 2 ? fitPieces(pieces, { maxSegments: 2, fallbackFor }) : null);
    if (text != null) return text;
    const next = shrinkBusinessName(biz);
    if (next === biz) {
      throw new Error(
        'fitSms: message exceeds max segments after dropping optional pieces',
      );
    }
    biz = next;
  }
}

function questionsCall(brand: SmsBrand): string | null {
  if (!brand.contactPhone) return null;
  const display = formatUkPhoneDisplay(brand.contactPhone);
  if (!display) return null;
  return `Questions? Call ${display}`;
}

function withCall(pieces: SmsPiece[], brand: SmsBrand, drop: number): SmsPiece[] {
  const call = questionsCall(brand);
  if (!call) return pieces;
  return [...pieces, { text: call, drop }];
}

/**
 * Money texts: the trader's number is never dropped, so a customer who has
 * paid or has a question rings the trader, not the shared WorkWise number.
 * The text may go to two segments to keep it (owner, 2026-09-29).
 */
function withRequiredCall(pieces: SmsPiece[], brand: SmsBrand): SmsPiece[] {
  const call = questionsCall(brand);
  if (!call) return pieces;
  return [...pieces, { text: call }];
}

function phoneToken(brand: SmsBrand): string {
  if (!brand.contactPhone) return '';
  return formatUkPhoneDisplay(brand.contactPhone) ?? '';
}

function customOrNull(
  template: string | null | undefined,
  businessName: string,
  valuesFor: (business: string) => Record<string, string>,
  appendStop: boolean,
): string | null {
  const trimmed = template?.trim();
  if (!trimmed) return null;
  const rendered = renderWording({
    template: trimmed,
    businessName,
    shortenName: shortBusinessName,
    shrinkName: shrinkBusinessName,
    valuesFor,
    appendStop,
    maxSegments: 2,
  });
  return rendered.fitted ? rendered.text : null;
}

export function reminderSms(p: {
  brand: SmsBrand;
  address: string;
  day: string;
  services: string[];
  time: string | null;
  firstText: boolean;
  /** Saved sentence. Null or omitted uses the standard wording. */
  wording?: string | null;
}): string {
  const custom = customOrNull(
    p.wording,
    p.brand.businessName,
    (biz) => ({
      business: biz,
      address: shortAddress(p.address),
      date: p.day,
      time: timeLabel(p.time) ?? '',
      job: serviceLabel(p.services),
      phone: phoneToken(p.brand),
    }),
    p.firstText,
  );
  if (custom) return custom;
  return fitBranded(p.brand.businessName, (biz) => {
    const pieces: SmsPiece[] = [
      { text: `${biz}: we're due at ${shortAddress(p.address)} on ${p.day}` },
    ];
    const time = timeLabel(p.time);
    if (time) pieces.push({ text: time, drop: 2 });
    pieces.push({ text: `for your ${serviceLabel(p.services)}`, drop: 1 });
    pieces.push({ text: `. Reply NO if that's a problem.`, glue: 'none' });
    const withQuestions = withCall(pieces, p.brand, 3);
    if (p.firstText) withQuestions.push({ text: 'Reply STOP to opt out.' });
    return withQuestions;
  });
}

function doneWhen(dayLabel: string | null, punct: '.' | ','): string {
  const when = dayLabel ? `on ${dayLabel}` : 'today';
  return `done ${when}${punct}`;
}

/** "Biz: your window clean at 12 Elm Rd was done today." — "was" keeps it a sentence. */
export function visitDoneSms(p: {
  brand: SmsBrand;
  services: string[];
  address: string;
  dayLabel: string | null;
  outcome:
    | { kind: 'to_pay'; amount: number; payUrl: string }
    | { kind: 'invoice'; number: string; amount: number; invoiceUrl: string }
    | { kind: 'paid_now'; amount: number; method: 'cash' | 'cheque'; creditLeft: number }
    | { kind: 'paid_by_credit'; creditLeft: number }
    | { kind: 'direct_debit'; amount: number; collectOn: string };
  /** Saved sentence for this outcome. Null or omitted uses the standard wording. */
  wording?: string | null;
}): string {
  const custom = customOrNull(
    p.wording,
    p.brand.businessName,
    (biz) => visitDoneTokenValues(p, biz),
    false,
  );
  if (custom) return custom;
  const serviceText = `${serviceLabel(p.services)} at ${shortAddress(p.address)}`;
  const tail: SmsPiece[] = [];

  switch (p.outcome.kind) {
    case 'to_pay':
      tail.push(
        { text: doneWhen(p.dayLabel, '.') },
        { text: `${formatGbp(p.outcome.amount)} to pay: ${p.outcome.payUrl}` },
        { text: 'Thanks!', drop: 1 },
      );
      break;
    case 'direct_debit':
      tail.push(
        { text: doneWhen(p.dayLabel, '.') },
        {
          text: `${formatGbp(p.outcome.amount, { always2dp: true })} will be collected by Direct Debit on or after ${p.outcome.collectOn}.`,
        },
      );
      break;
    case 'invoice':
      tail.push(
        { text: doneWhen(p.dayLabel, '.') },
        {
          text: `Invoice ${p.outcome.number} for ${formatGbp(p.outcome.amount)}: ${p.outcome.invoiceUrl}`,
        },
      );
      break;
    case 'paid_now':
      tail.push(
        { text: doneWhen(p.dayLabel, '.') },
        {
          text: `Thanks for the ${formatGbp(p.outcome.amount)} ${p.outcome.method}!`,
        },
      );
      if (p.outcome.creditLeft > 0) {
        tail.push({
          text: `You've ${formatGbp(p.outcome.creditLeft)} credit for next time.`,
          drop: 1,
        });
      }
      break;
    case 'paid_by_credit':
      tail.push({
        text: `${doneWhen(p.dayLabel, ',')} paid from your credit`,
      });
      if (p.outcome.creditLeft > 0) {
        tail.push({
          text: `(${formatGbp(p.outcome.creditLeft)} left)`,
          drop: 1,
        });
      }
      tail.push({ text: '.', glue: 'none' });
      break;
  }

  return fitBranded(
    p.brand.businessName,
    (biz) =>
      withRequiredCall(
        [{ text: `${biz}: your` }, { text: serviceText, drop: 2 }, { text: 'was' }, ...tail],
        p.brand,
      ),
    (piece) => (piece.text === serviceText ? 'visit' : null),
    2,
  );
}

function visitDoneDate(dayLabel: string | null): string {
  return dayLabel ? `on ${dayLabel}` : 'today';
}

function visitDoneTokenValues(
  p: {
    brand: SmsBrand;
    services: string[];
    address: string;
    dayLabel: string | null;
    outcome:
      | { kind: 'to_pay'; amount: number; payUrl: string }
      | { kind: 'invoice'; number: string; amount: number; invoiceUrl: string }
      | { kind: 'paid_now'; amount: number; method: 'cash' | 'cheque'; creditLeft: number }
      | { kind: 'paid_by_credit'; creditLeft: number }
      | { kind: 'direct_debit'; amount: number; collectOn: string };
  },
  biz: string,
): Record<string, string> {
  const base = {
    business: biz,
    job: serviceLabel(p.services),
    address: shortAddress(p.address),
    date: visitDoneDate(p.dayLabel),
    phone: phoneToken(p.brand),
  };
  switch (p.outcome.kind) {
    case 'to_pay':
      return {
        ...base,
        amount: formatGbp(p.outcome.amount),
        pay_link: p.outcome.payUrl,
      };
    case 'invoice':
      return {
        ...base,
        invoice: p.outcome.number,
        amount: formatGbp(p.outcome.amount),
        invoice_link: p.outcome.invoiceUrl,
      };
    case 'paid_now':
      return {
        ...base,
        amount: formatGbp(p.outcome.amount),
        method: p.outcome.method,
        credit:
          p.outcome.creditLeft > 0
            ? `You've ${formatGbp(p.outcome.creditLeft)} credit for next time. `
            : '',
      };
    case 'paid_by_credit':
      return {
        ...base,
        credit: p.outcome.creditLeft > 0 ? ` (${formatGbp(p.outcome.creditLeft)} left)` : '',
      };
    case 'direct_debit':
      return {
        ...base,
        amount: formatGbp(p.outcome.amount, { always2dp: true }),
        collect_on: p.outcome.collectOn,
      };
  }
}

/** forVisits false (only other amounts owed, no visits) never says "for your recent visits". */
export function chaserSms(p: {
  brand: SmsBrand;
  owed: number;
  payUrl: string;
  stage: 1 | 2;
  forVisits?: boolean;
}): string {
  const money = formatGbp(p.owed);
  const forVisits = p.forVisits !== false;
  return fitBranded(
    p.brand.businessName,
    (biz) => {
      if (p.stage === 1) {
        return withRequiredCall(
          [
            { text: `${biz}: a friendly reminder, ${money} to pay` },
            // The pay page lists the visits; dropping this keeps one segment.
            ...(forVisits ? [{ text: 'for your recent visits', drop: 2 }] : []),
            { text: `. Pay here: ${p.payUrl}`, glue: 'none' },
            { text: 'Thanks!', drop: 1 },
          ],
          p.brand,
        );
      }
      return withRequiredCall(
        [
          {
            text: `${biz}: just a nudge, ${money} is still to pay. Pay here: ${p.payUrl}`,
          },
          { text: "If you've already paid, thank you!", drop: 1 },
        ],
        p.brand,
      );
    },
    undefined,
    2,
  );
}

/** Phase 4 Direct Debit invitation (≤ 2 segments; the trader's number is kept). */
export function directDebitInviteSms(p: { brand: SmsBrand; url: string }): string {
  return fitBranded(
    p.brand.businessName,
    (biz) =>
      withRequiredCall(
        [{ text: `${biz}: pay automatically by Direct Debit after each visit. Set up in 2 mins: ${p.url}` }],
        p.brand,
      ),
    undefined,
    2,
  );
}

/** Phase 4 failed Direct Debit collection (≤ 2 segments; the trader's number is kept). */
export function directDebitFailedSms(p: { brand: SmsBrand; amount: number; url: string }): string {
  return fitBranded(
    p.brand.businessName,
    (biz) =>
      withRequiredCall(
        [{ text: `${biz}: we couldn't collect ${formatGbp(p.amount, { always2dp: true })} by Direct Debit. Pay here: ${p.url}` }],
        p.brand,
      ),
    undefined,
    2,
  );
}

/** A refund the trader made in WorkWise is on its way (≤ 2 segments). */
export function refundSms(p: { brand: SmsBrand; amount: number }): string {
  return fitBranded(
    p.brand.businessName,
    (biz) =>
      withRequiredCall(
        [
          {
            text: `${biz}: we've refunded ${formatGbp(p.amount, { always2dp: true })} to your bank account. It can take a few days to arrive.`,
          },
        ],
        p.brand,
      ),
    undefined,
    2,
  );
}

export function paymentReceivedSms(p: {
  brand: SmsBrand;
  amount: number;
  methodLabel: string;
  owedLeft: number;
  payUrl: string | null;
  creditLeft: number;
}): string {
  return fitBranded(p.brand.businessName, (biz) => {
    const pieces: SmsPiece[] = [
      {
        text: `${biz}: thanks for your ${formatGbp(p.amount)} ${p.methodLabel} payment.`,
      },
    ];
    if (p.owedLeft <= 0) {
      pieces.push({ text: "You're all paid up!" });
      if (p.creditLeft > 0) {
        pieces.push({
          text: `You've ${formatGbp(p.creditLeft)} credit.`,
          drop: 1,
        });
      }
    } else {
      const link = p.payUrl ? `: ${p.payUrl}` : '';
      pieces.push({ text: `${formatGbp(p.owedLeft)} still to pay${link}` });
    }
    return withRequiredCall(pieces, p.brand);
  }, undefined, 2);
}

export function dayMovedSms(p: {
  brand: SmsBrand;
  fromDay: string;
  toDay: string;
}): string {
  return fitBranded(p.brand.businessName, (biz) =>
    withCall(
      [
        {
          text: `${biz}: really sorry, we can't make ${p.fromDay}. We'd like to come on ${p.toDay} instead. If that doesn't work, get in touch.`,
        },
      ],
      p.brand,
      1,
    ),
  );
}

export function daySkippedSms(p: {
  brand: SmsBrand;
  day: string;
  nextDay: string | null;
}): string {
  return fitBranded(
    p.brand.businessName,
    (biz) => {
      const pieces: SmsPiece[] = [
        { text: `${biz}: really sorry, we can't make ${p.day}.` },
      ];
      if (p.nextDay) {
        pieces.push({
          text: `We'd like to come next on ${p.nextDay}. If that doesn't work, get in touch.`,
          drop: 2,
        });
      } else {
        pieces.push({ text: 'If you need another day, get in touch.' });
      }
      return withCall(pieces, p.brand, 1);
    },
    (piece) => (piece.drop === 2 ? 'If you need another day, get in touch.' : null),
  );
}

export function afterAllSms(p: { brand: SmsBrand; day: string }): string {
  return fitBranded(p.brand.businessName, (biz) =>
    withCall(
      [
        {
          text: `${biz}: good news, we'd like to come on ${p.day} after all. If that doesn't work, get in touch.`,
        },
      ],
      p.brand,
      1,
    ),
  );
}

export function replySkipAckSms(p: {
  brand: SmsBrand;
  day: string;
  nextDay: string | null;
}): string {
  return fitBranded(p.brand.businessName, (biz) => {
    const pieces: SmsPiece[] = [
      { text: `${biz}: thanks for letting us know. We'll leave ${p.day}.` },
    ];
    if (p.nextDay) {
      pieces.push({
        text: `We'd like to come next on ${p.nextDay}. If that doesn't work, get in touch.`,
        drop: 2,
      });
    } else {
      pieces.push({ text: 'If you need another day, get in touch.' });
    }
    return withCall(pieces, p.brand, 1);
  }, (piece) => (piece.drop === 2 ? 'If you need another day, get in touch.' : null));
}

export function replyMoveAckSms(p: { brand: SmsBrand; toDay: string }): string {
  return fitBranded(p.brand.businessName, (biz) =>
    withCall(
      [
        { text: `${biz}: thanks for letting us know. We'd like to come on ${p.toDay}. If that doesn't work, get in touch.` },
      ],
      p.brand,
      1,
    ),
  );
}

export const UNKNOWN_NUMBER_SMS =
  "This number only sends visit messages for local tradespeople and isn't read. Please contact your tradesperson directly.";

const SAMPLE_PAY_URL = `https://app.joinworkwise.com/pay/${'a'.repeat(32)}`;
const SAMPLE_INVOICE_URL = `https://app.joinworkwise.com/pay/i/${'a'.repeat(32)}`;

export type WordingPreview = {
  text: string;
  length: number;
  segments: number;
  /** Why Save stays off. Null when the sentence can be saved. */
  error: string | null;
};

/** Live example under the wording box. The standard sentence uses the real sender. */
export function messageWordingPreview(
  key: WordingKey,
  template: string,
  brand: SmsBrand,
): WordingPreview {
  const shapeError = checkWordingShape(key, template);
  const custom = template.trim() === STANDARD_WORDING[key] ? null : template;
  const rendered =
    custom == null
      ? { text: standardPreview(key, brand), fitted: true }
      : renderWording({
          template: custom,
          businessName: brand.businessName,
          shortenName: shortBusinessName,
          shrinkName: shrinkBusinessName,
          valuesFor: (biz) => previewValues(key, brand, biz),
          appendStop: key === 'reminder',
          maxSegments: 2,
        });
  const counted = countSegments(rendered.text);
  let error = shapeError;
  if (!error && !rendered.fitted) {
    error = 'Too long. A message can be 2 texts at most. Shorten it.';
  }
  if (!error && rendered.text.trim() === '') error = 'Write the message.';
  return {
    text: rendered.text,
    length: counted.length,
    segments: counted.segments,
    error,
  };
}

function standardPreview(key: WordingKey, brand: SmsBrand): string {
  if (key === 'reminder') {
    return reminderSms({
      brand,
      address: '12 Elm Rd',
      day: 'Thu 2 Oct',
      services: ['Window clean'],
      time: '09:30',
      firstText: true,
    });
  }
  return visitDoneSms({
    brand,
    services: ['Window clean'],
    address: '12 Elm Rd',
    dayLabel: null,
    outcome: previewOutcome(key),
  });
}

function previewValues(key: WordingKey, brand: SmsBrand, biz: string): Record<string, string> {
  if (key === 'reminder') {
    return {
      business: biz,
      address: shortAddress('12 Elm Rd'),
      date: 'Thu 2 Oct',
      time: timeLabel('09:30') ?? '',
      job: serviceLabel(['Window clean']),
      phone: phoneToken(brand),
    };
  }
  return visitDoneTokenValues(
    {
      brand,
      services: ['Window clean'],
      address: '12 Elm Rd',
      dayLabel: null,
      outcome: previewOutcome(key),
    },
    biz,
  );
}

function previewOutcome(key: WordingKey): {
  kind: 'to_pay';
  amount: number;
  payUrl: string;
} | {
  kind: 'invoice';
  number: string;
  amount: number;
  invoiceUrl: string;
} | {
  kind: 'paid_now';
  amount: number;
  method: 'cash';
  creditLeft: number;
} | {
  kind: 'paid_by_credit';
  creditLeft: number;
} | {
  kind: 'direct_debit';
  amount: number;
  collectOn: string;
} {
  switch (key) {
    case 'visit_done_to_pay':
      return { kind: 'to_pay', amount: 15, payUrl: SAMPLE_PAY_URL };
    case 'visit_done_paid_now':
      return { kind: 'paid_now', amount: 15, method: 'cash', creditLeft: 3 };
    case 'visit_done_paid_credit':
      return { kind: 'paid_by_credit', creditLeft: 3 };
    case 'visit_done_invoice':
      return { kind: 'invoice', number: 'INV-0042', amount: 15, invoiceUrl: SAMPLE_INVOICE_URL };
    case 'visit_done_direct_debit':
      return { kind: 'direct_debit', amount: 15, collectOn: 'Tue 7 Oct' };
    case 'reminder':
      return { kind: 'to_pay', amount: 15, payUrl: SAMPLE_PAY_URL };
  }
}
