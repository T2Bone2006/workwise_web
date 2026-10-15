import { Briefcase, User } from 'lucide-react';
import { CopyChip, LookCard, Tag } from '@/components/look';
import { formatPounds } from '@/components/lite/leads/lead-card';
import { Button } from '@/components/ui/button';
import type { LeadDetail } from '@/lib/data/lite/lead-detail';

const DAY_LABEL: Record<string, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  any: 'Any day',
};

function daysLabel(days: string[]): string | null {
  if (days.length === 0) return null;
  if (days.includes('any')) return 'Any day';
  return days.map((day) => DAY_LABEL[day] ?? day).join(', ');
}

function dialable(display: string): string {
  return display.replace(/[^\d+]/g, '');
}

function Row({ label, children }: { label: string; children: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words">{children}</dd>
    </div>
  );
}

export function CustomerCard({ lead }: { lead: LeadDetail['lead'] }) {
  const mobile = lead.mobileDisplay;
  const number = mobile ? dialable(mobile) : '';
  const days = daysLabel(lead.preferredDays);
  const email = lead.email && !/[\s<>"]/.test(lead.email) ? lead.email : null;

  return (
    <LookCard title="Customer" icon={User} tone="lite">
      {mobile && number ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button asChild className="bg-(--tone-lite-solid) text-white hover:bg-(--tone-lite-solid)/90">
              <a href={`tel:${number}`}>Call</a>
            </Button>
            <Button asChild variant="outline">
              <a href={`sms:${number}`}>Text</a>
            </Button>
            <CopyChip kind="phone" label="Mobile number" value={mobile} />
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No mobile saved.</p>
      )}
      <dl className="mt-4 space-y-3 border-t border-border pt-4 text-sm">
        {email ? (
          <div>
            <dt className="text-xs text-muted-foreground">Email</dt>
            <dd className="mt-0.5 break-all">
              <a href={`mailto:${email}`} className="font-medium text-primary hover:underline">
                {email}
              </a>
            </dd>
          </div>
        ) : null}
        {lead.postcode ? <Row label="Postcode">{lead.postcode}</Row> : null}
        {days ? <Row label="Days that suit">{days}</Row> : null}
        {lead.customerNote ? <Row label="Their note">{lead.customerNote}</Row> : null}
      </dl>
    </LookCard>
  );
}

export function JobCard({ lead }: { lead: LeadDetail['lead'] }) {
  const offered = offeredPrice(lead.quote);
  const agreed = typeof lead.agreedAmount === 'number' ? formatPounds(lead.agreedAmount) : null;
  const empty = !lead.jobSummary && !offered && !agreed;

  return (
    <LookCard title="The job" icon={Briefcase} tone="emerald">
      {empty ? (
        <p className="text-sm text-muted-foreground">Nothing was saved about the job.</p>
      ) : (
        <div className="space-y-3 text-sm">
          {lead.jobSummary ? <p className="text-[15px] whitespace-pre-wrap">{lead.jobSummary}</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            {offered ? (
              <>
                <span className="text-2xl font-semibold tracking-tight tabular-nums">{offered.price}</span>
                {offered.note ? (
                  <Tag
                    tone="lite"
                    className={offered.note === 'firm price' ? undefined : 'border border-(--tone-lite-solid) bg-transparent'}
                  >
                    {offered.note === 'firm price' ? 'Firm price' : 'Guide price'}
                  </Tag>
                ) : (
                  <Tag tone="lite" className="border border-(--tone-lite-solid) bg-transparent">Look-and-quote visit</Tag>
                )}
              </>
            ) : null}
            {agreed ? (
              <span className="ml-auto text-sm">
                <span className="text-muted-foreground">Agreed </span>
                <span className="font-semibold text-(--tone-emerald-text) tabular-nums">{agreed}</span>
              </span>
            ) : null}
          </div>
        </div>
      )}
    </LookCard>
  );
}

function offeredPrice(quote: LeadDetail['lead']['quote']): { price: string; note: string } | null {
  if (!quote) return null;
  if (quote.kind === 'firm' && typeof quote.amount === 'number') {
    return { price: formatPounds(quote.amount), note: 'firm price' };
  }
  if (quote.kind === 'guide' && typeof quote.min === 'number' && typeof quote.max === 'number') {
    return { price: `${formatPounds(quote.min)}\u2013${formatPounds(quote.max)}`, note: 'guide' };
  }
  if (quote.kind === 'visit') return { price: 'Free look-and-quote visit', note: '' };
  return null;
}
