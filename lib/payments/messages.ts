import { visitDoneSms } from '@/lib/messaging/templates';
import { formatGbp } from '@/lib/money/pence';
import { formatSortCode } from '@/lib/payments/bank-format';

export type PaymentMethodLabel =
  | 'cash'
  | 'cheque'
  | 'bank_transfer'
  | 'card'
  | 'direct_debit'
  | 'pay_by_bank'
  | 'other';

export type VisitDoneMessageInput = {
  businessName: string;
  customerName: string;
  visitDate: string;
  serviceTitle: string;
  address: string;
  visitDue: number;
  paidNow: { method: 'cash' | 'cheque'; amount: number } | null;
  visitStatus: 'paid' | 'partial' | 'unpaid' | 'waived';
  visitOutstanding: number;
  customerOwedTotal: number;
  customerCredit: number;
  payUrl: string | null;
  bank: { accountName: string; sortCode: string; accountNumber: string } | null;
  reference: string | null;
  invoiceNumber: string | null;
  /** Set for a customer whose Direct Debit will collect this (D8): no pay link, no bank line. */
  directDebit: { collectOn: string } | null;
};

export type ComposedMessage = {
  subject: string;
  greeting: string;
  paragraphs: string[];
  payUrl: string | null;
  bankLine: string | null;
  signOff: string;
  text: string;
};

const GREETING_TITLES = new Set(['MR', 'MRS', 'MS', 'MISS', 'DR']);

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** 'Thu 24 Sep' from a Ymd, no timezone shift. Fixed English abbreviations (not Intl — Node en-GB uses 'Sept'). */
export function formatVisitDay(ymd: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) {
    throw new Error(`Invalid visitDate Ymd: ${ymd}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return `${WEEKDAYS[utc.getUTCDay()]} ${day} ${MONTHS[month - 1]}`;
}

export function firstNameForGreeting(customerName: string): string | null {
  const first = customerName.trim().split(/\s+/)[0] ?? '';
  const letters = first.replace(/[^A-Za-z]/g, '');
  if (letters.length < 2) return null;
  if (GREETING_TITLES.has(letters.toUpperCase())) return null;
  return first.replace(/[^A-Za-z'-]/g, '') || null;
}

function greetingLine(customerName: string): string {
  const first = firstNameForGreeting(customerName);
  return first ? `Hi ${first},` : 'Hello,';
}

function buildBankLine(
  bank: VisitDoneMessageInput['bank'],
  reference: string | null,
): string | null {
  if (!bank) return null;
  const sort = formatSortCode(bank.sortCode);
  let line = `You can also pay by bank transfer: ${bank.accountName}, sort code ${sort}, account ${bank.accountNumber}`;
  if (reference) {
    line += `, reference ${reference}`;
  }
  return `${line}.`;
}

function replyPrompt(): string {
  return 'Any questions? Just reply to this email — happy to help.';
}

function buildText(parts: {
  greeting: string;
  paragraphs: string[];
  payUrl: string | null;
  bankLine: string | null;
  signOff: string;
}): string {
  const chunks: string[] = [parts.greeting, '', ...parts.paragraphs];
  if (parts.payUrl) {
    chunks.push('', parts.payUrl);
  }
  if (parts.bankLine) {
    chunks.push('', parts.bankLine);
  }
  chunks.push('', parts.signOff);
  return chunks.join('\n');
}

/** null when there is nothing to tell the customer (visitStatus 'waived'). */
export function composeVisitDoneMessage(
  input: VisitDoneMessageInput,
): ComposedMessage | null {
  if (input.visitStatus === 'waived') return null;

  const day = formatVisitDay(input.visitDate);
  const greeting = greetingLine(input.customerName);
  const paragraphs: string[] = [];

  paragraphs.push(
    `${input.businessName} finished your ${input.serviceTitle.toLowerCase()} at ${input.address} on ${day}.`,
  );

  if (input.paidNow) {
    paragraphs.push(
      `Thanks so much for your payment of ${formatGbp(input.paidNow.amount)} by ${input.paidNow.method}.`,
    );
  }

  if (input.visitStatus === 'paid') {
    if (input.paidNow) {
      if (input.customerCredit > 0) {
        paragraphs.push(
          `You've got ${formatGbp(input.customerCredit)} credit ready for next time.`,
        );
      }
    } else {
      paragraphs.push(
        `This visit (${formatGbp(input.visitDue)}) was covered by your credit.`,
      );
      if (input.customerCredit > 0) {
        paragraphs.push(
          `You've still got ${formatGbp(input.customerCredit)} credit left.`,
        );
      }
    }
  } else if (input.directDebit) {
    paragraphs.push(
      `${formatGbp(input.visitOutstanding, { always2dp: true })} will be collected by Direct Debit on or after ${input.directDebit.collectOn}. You don't need to do anything.`,
    );
  } else {
    // partial or unpaid
    paragraphs.push(
      `There's ${formatGbp(input.visitOutstanding)} to pay for this visit whenever you're ready.`,
    );
    if (input.customerOwedTotal > input.visitOutstanding) {
      paragraphs.push(
        `Including earlier visits, that comes to ${formatGbp(input.customerOwedTotal)} in total.`,
      );
    }
  }

  if (input.invoiceNumber) {
    paragraphs.push(`Invoice ${input.invoiceNumber} is attached for you.`);
  }

  paragraphs.push(replyPrompt());

  const needsPay =
    !input.directDebit &&
    (input.visitStatus === 'partial' || input.visitStatus === 'unpaid');
  const payUrl = needsPay ? input.payUrl : null;
  const bankLine = needsPay
    ? buildBankLine(input.bank, input.reference)
    : null;

  const subject = input.invoiceNumber
    ? `Invoice ${input.invoiceNumber} from ${input.businessName}`
    : `${input.businessName}: your visit on ${day}`;

  const signOff = `Thanks,\n${input.businessName}`;

  return {
    subject,
    greeting,
    paragraphs,
    payUrl,
    bankLine,
    signOff,
    text: buildText({ greeting, paragraphs, payUrl, bankLine, signOff }),
  };
}

/** The text version of the visit-done message. Same facts as composeVisitDoneMessage. null when waived. */
export function composeVisitDoneSms(
  input: VisitDoneMessageInput,
  extra: {
    services: string[];
    visitDate: string;
    today: string;
    invoiceUrl: string | null;
    contactPhone: string | null;
  },
): string | null {
  if (input.visitStatus === 'waived') return null;

  const dayLabel =
    extra.visitDate === extra.today ? null : formatVisitDay(extra.visitDate);
  const brand = {
    businessName: input.businessName,
    contactPhone: extra.contactPhone,
  };
  const base = {
    brand,
    services: extra.services,
    address: input.address,
    dayLabel,
  };

  if (input.directDebit && (input.visitStatus === 'partial' || input.visitStatus === 'unpaid')) {
    return visitDoneSms({
      ...base,
      outcome: {
        kind: 'direct_debit',
        amount: input.visitOutstanding,
        collectOn: input.directDebit.collectOn,
      },
    });
  }

  if (input.invoiceNumber && extra.invoiceUrl) {
    const amount =
      input.visitOutstanding > 0 ? input.visitOutstanding : input.visitDue;
    return visitDoneSms({
      ...base,
      outcome: {
        kind: 'invoice',
        number: input.invoiceNumber,
        amount,
        invoiceUrl: extra.invoiceUrl,
      },
    });
  }

  if (input.paidNow) {
    return visitDoneSms({
      ...base,
      outcome: {
        kind: 'paid_now',
        amount: input.paidNow.amount,
        method: input.paidNow.method,
        creditLeft: input.customerCredit,
      },
    });
  }

  if (input.visitStatus === 'paid') {
    return visitDoneSms({
      ...base,
      outcome: { kind: 'paid_by_credit', creditLeft: input.customerCredit },
    });
  }

  if (input.payUrl === null) {
    throw new Error(
      'composeVisitDoneSms: payUrl required when something is owed',
    );
  }

  return visitDoneSms({
    ...base,
    outcome: {
      kind: 'to_pay',
      amount: input.visitOutstanding,
      payUrl: input.payUrl,
    },
  });
}

export function paymentMethodLabel(method: PaymentMethodLabel): string {
  switch (method) {
    case 'bank_transfer':
      return 'bank transfer';
    case 'card':
      return 'card';
    case 'direct_debit':
      return 'Direct Debit';
    case 'pay_by_bank':
      return 'bank';
    case 'other':
      return 'other';
    default:
      return method;
  }
}

/** Email after Mark as paid (dashboard or phone). Not used on Done — that is visit-done. */
export function composePaymentReceivedMessage(input: {
  businessName: string;
  customerName: string;
  amount: number;
  method: PaymentMethodLabel;
  customerOwedTotal: number;
  customerCredit: number;
  payUrl: string | null;
  bank: VisitDoneMessageInput['bank'];
  reference: string | null;
}): ComposedMessage {
  const greeting = greetingLine(input.customerName);
  const paragraphs: string[] = [
    `Thanks so much for your payment of ${formatGbp(input.amount)} by ${paymentMethodLabel(input.method)}.`,
  ];

  if (input.customerOwedTotal <= 0) {
    paragraphs.push("You're all paid up — thank you!");
    if (input.customerCredit > 0) {
      paragraphs.push(
        `You've got ${formatGbp(input.customerCredit)} credit ready for next time.`,
      );
    }
  } else {
    paragraphs.push(
      `That leaves ${formatGbp(input.customerOwedTotal)} still to pay whenever you're ready.`,
    );
  }

  paragraphs.push(replyPrompt());

  const needsPay = input.customerOwedTotal > 0;
  const payUrl = needsPay ? input.payUrl : null;
  const bankLine = needsPay
    ? buildBankLine(input.bank, input.reference)
    : null;
  const signOff = `Thanks,\n${input.businessName}`;

  return {
    subject: `Thanks for your payment — ${input.businessName}`,
    greeting,
    paragraphs,
    payUrl,
    bankLine,
    signOff,
    text: buildText({ greeting, paragraphs, payUrl, bankLine, signOff }),
  };
}

/**
 * Friendly payment reminder (stage 1) or nudge (stage 2). Always includes pay link.
 * forVisits false (nothing owed is a visit, only other amounts owed) drops
 * "for your recent visits".
 */
export function composeChaserMessage(input: {
  businessName: string;
  customerName: string;
  owed: number;
  stage: 1 | 2;
  payUrl: string;
  bank: VisitDoneMessageInput['bank'];
  reference: string | null;
  forVisits?: boolean;
}): ComposedMessage {
  const greeting = greetingLine(input.customerName);
  const money = formatGbp(input.owed);
  const forVisits = input.forVisits !== false ? ' for your recent visits' : '';
  const paragraphs: string[] =
    input.stage === 1
      ? [
          `Just a friendly reminder that there's ${money} to pay${forVisits}.`,
          replyPrompt(),
        ]
      : [
          `Just a nudge: ${money} is still to pay${forVisits}. If you've already paid, thank you, and please ignore this.`,
          replyPrompt(),
        ];

  const payUrl = input.payUrl;
  const bankLine = buildBankLine(input.bank, input.reference);
  const signOff = `Thanks,\n${input.businessName}`;
  const subject =
    input.stage === 1
      ? `${input.businessName}: a friendly payment reminder`
      : `${input.businessName}: payment reminder`;

  return {
    subject,
    greeting,
    paragraphs,
    payUrl,
    bankLine,
    signOff,
    text: buildText({ greeting, paragraphs, payUrl, bankLine, signOff }),
  };
}

/** Short text for Share pay link (≤ 320 chars). */
export function composeShareMessage(input: {
  businessName: string;
  customerName: string;
  owedTotal: number;
  unpaidVisits: number;
  payUrl: string;
  bank: VisitDoneMessageInput['bank'];
  reference: string | null;
}): string {
  const first =
    firstNameForGreeting(input.customerName) ??
    input.customerName.trim().split(/\s+/)[0] ??
    'there';

  if (input.owedTotal <= 0) {
    return `Hi ${first}, it's ${input.businessName}. You're all paid up — thank you!`;
  }

  // Nothing owed may be a visit (only other amounts owed, Phase 4 D12).
  const visitsBit =
    input.unpaidVisits <= 0
      ? ''
      : input.unpaidVisits === 1
        ? ' for 1 visit'
        : ` for ${input.unpaidVisits} visits`;
  let msg = `Hi ${first}, it's ${input.businessName}. There's ${formatGbp(input.owedTotal)} to pay${visitsBit}. Pay online: ${input.payUrl}`;
  if (input.bank) {
    const sort = formatSortCode(input.bank.sortCode);
    const refBit = input.reference ? `, ref ${input.reference}` : '';
    msg += ` or by bank transfer to ${sort} ${input.bank.accountNumber}${refBit}`;
  }
  msg += '. Thanks!';
  return msg;
}
