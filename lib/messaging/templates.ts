import { countSegments, toGsm7 } from '@/lib/messaging/gsm';
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

export function reminderSms(p: {
  brand: SmsBrand;
  address: string;
  day: string;
  services: string[];
  time: string | null;
  firstText: boolean;
}): string {
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
}): string {
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
          text: `${biz}: sorry, we can't make it on ${p.fromDay}. We'll come on ${p.toDay} instead.`,
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
  return fitBranded(p.brand.businessName, (biz) => {
    const pieces: SmsPiece[] = [
      {
        text: `${biz}: sorry, we can't make it on ${p.day}. See you next time`,
      },
    ];
    if (p.nextDay) pieces.push({ text: `on ${p.nextDay}`, drop: 2 });
    pieces.push({ text: '.', glue: 'none' });
    return withCall(pieces, p.brand, 1);
  });
}

export function afterAllSms(p: { brand: SmsBrand; day: string }): string {
  return fitBranded(p.brand.businessName, (biz) =>
    withCall(
      [
        {
          text: `${biz}: good news, we can make it on ${p.day} after all. See you then!`,
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
      { text: `${biz}: no problem, we'll skip ${p.day}.` },
    ];
    if (p.nextDay) {
      pieces.push({ text: `See you on ${p.nextDay}.`, drop: 2 });
    }
    return withCall(pieces, p.brand, 1);
  });
}

export function replyMoveAckSms(p: { brand: SmsBrand; toDay: string }): string {
  return fitBranded(p.brand.businessName, (biz) =>
    withCall(
      [
        { text: `${biz}: no problem, we'll come on ${p.toDay} instead.` },
      ],
      p.brand,
      1,
    ),
  );
}

export const UNKNOWN_NUMBER_SMS =
  "This number only sends visit messages for local tradespeople and isn't read. Please contact your tradesperson directly.";
