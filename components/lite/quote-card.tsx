'use client';

import type { JSX } from 'react';
import type { PublicQuote } from '@/lib/widget/conversation';

function pounds(n: number): string {
  const cents = Math.round(n * 100);
  if (cents % 100 === 0) return String(cents / 100);
  const whole = Math.floor(cents / 100);
  const pence = cents % 100;
  return `${whole}.${String(pence).padStart(2, '0')}`;
}

/** Practice-chat mirror of an estimate. The button does not send anything. */
export function QuoteCard(props: {
  quote: PublicQuote;
  businessName: string;
  disabledNote?: string;
}): JSX.Element {
  const { quote, businessName, disabledNote } = props;
  const price =
    quote.kind === 'firm'
      ? `£${pounds(quote.amount)}`
      : quote.kind === 'guide'
        ? `Usually £${pounds(quote.min)}–£${pounds(quote.max)}`
        : 'Needs a look';
  const note =
    quote.kind === 'firm'
      ? `An estimate from ${businessName}. This can change.`
      : quote.kind === 'guide'
        ? `${businessName} will agree the price with them.`
        : 'Needs a look before a price.';

  return (
    <div className="max-w-[92%] self-start rounded-2xl border border-[#EBEBEA] bg-white p-3.5 shadow-sm">
      <div className="text-[22px] font-bold leading-tight text-[#0A1A2E]">{price}</div>
      {quote.summary ? <div className="mt-1 text-sm text-[#0A1A2E]">{quote.summary}</div> : null}
      {note ? <div className="mt-1.5 text-xs text-[#6B6964]">{note}</div> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled
          className="rounded-full bg-[#0A1A2E]/80 px-3.5 py-2 text-[13px] text-white opacity-40"
        >
          Leave my details
        </button>
        <button
          type="button"
          disabled
          className="rounded-full border border-[#EBEBEA] bg-white px-3 py-2 text-[13px] text-[#0A1A2E] opacity-40"
        >
          Ask something else
        </button>
      </div>
      {disabledNote ? <p className="mt-2 text-xs text-[#6B6964]">{disabledNote}</p> : null}
    </div>
  );
}
