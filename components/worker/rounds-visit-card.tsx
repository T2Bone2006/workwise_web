import { KeyRound, MessageSquare, Phone, PoundSterling } from 'lucide-react';
import { LookCard } from '@/components/look';
import { Button } from '@/components/ui/button';
import { formatGbp } from '@/lib/money/pence';
import { smsHref, telHref } from '@/lib/worker/field-link';

/** A lead's visit page: the price, how to get in, and call / text the customer. Reading only: no money history. */
export function RoundsVisitCard({
  price,
  phone,
  accessNotes,
}: {
  price: number | null;
  phone: string | null;
  accessNotes: string | null;
}) {
  const tel = telHref(phone);
  const sms = smsHref(phone);
  return (
    <LookCard title="This visit" icon={PoundSterling} tone="emerald">
      <p className="text-2xl font-semibold tracking-tight tabular-nums">{price != null ? formatGbp(price) : '—'}</p>
      {accessNotes ? (
        <p className="mt-3 flex items-start gap-2 text-sm text-(--tone-amber-text)">
          <KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="min-w-0 whitespace-pre-wrap">{accessNotes}</span>
        </p>
      ) : null}
      {tel || sms ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {tel ? (
            <Button asChild className="min-h-11">
              <a href={tel}>
                <Phone /> Call
              </a>
            </Button>
          ) : null}
          {sms ? (
            <Button asChild variant="outline" className="min-h-11">
              <a href={sms}>
                <MessageSquare /> Text
              </a>
            </Button>
          ) : null}
        </div>
      ) : null}
    </LookCard>
  );
}
