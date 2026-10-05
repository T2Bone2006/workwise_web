import Link from 'next/link';
import { ArrowLeft, MessagesSquare, MessageSquareOff } from 'lucide-react';
import { Avatar, LookCard, Notice, Tag, type Tone } from '@/components/look';
import { notFound } from 'next/navigation';
import { BookedForEditor } from '@/components/lite/lead/booked-for-editor';
import { CustomerCard, JobCard } from '@/components/lite/lead/customer-card';
import { LeadStatusControl } from '@/components/lite/lead/decision-card';
import { RoundsActions } from '@/components/lite/lead/rounds-actions';
import { TextsTimeline } from '@/components/lite/lead/texts-timeline';
import { ConversationTranscript, londonWhen } from '@/components/lite/conversation-transcript';
import { getLeadDetail, type LeadDetail } from '@/lib/data/lite/lead-detail';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { requireLite } from '@/lib/lite/require-lite';
import { litePaths } from '@/lib/navigation/lite-paths';
import { createClient } from '@/lib/supabase/server';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS_TONE: Record<string, Tone> = {
  new: 'rounds',
  contacted: 'indigo',
  won: 'emerald',
  lost: 'slate',
};

const STATUS_LABEL = {
  new: 'New',
  contacted: 'Contacted',
  won: 'Won',
  lost: 'Lost',
} as const;

async function linkedCustomerName(tenantId: string, customerId: string | null): Promise<string | null> {
  if (!customerId) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('customers')
    .select('name')
    .eq('tenant_id', tenantId)
    .eq('id', customerId)
    .maybeSingle();
  if (error || !data || typeof (data as { name?: unknown }).name !== 'string') return null;
  const name = (data as { name: string }).name.trim();
  return name === '' ? null : name;
}

function cameIn(iso: string): string {
  const when = londonWhen(iso);
  if (!when) return 'From your website';
  return `From your website \u00b7 ${when.dayMonth}, ${when.hm}`;
}

function FollowUpBanner({ problem }: { problem: NonNullable<LeadDetail['lead']['flags']['followUpProblem']> }) {
  if (problem === 'out_of_texts') {
    return (
      <Notice
        tone="amber"
        icon={MessageSquareOff}
        title="Your follow-up text didn't go"
        action={
          <Link href={`${litePaths.widget}#texts`} className="text-sm font-semibold text-primary hover:underline">
            Buy more texts
          </Link>
        }
      >
        You&apos;re out of texts this month.
      </Notice>
    );
  }
  if (problem === 'opted_out') {
    return (
      <Notice tone="amber" icon={MessageSquareOff} title="They don't want texts">
        They&apos;ve asked not to get texts. Ring them instead.
      </Notice>
    );
  }
  return (
    <Notice tone="amber" icon={MessageSquareOff} title="Your follow-up text didn't send">
      Ring or text them from your own phone.
    </Notice>
  );
}

function quoteTag(quote: LeadDetail['lead']['quote']): { text: string; solid: boolean } | null {
  if (!quote) return null;
  if (quote.kind === 'firm') return { text: 'Firm price', solid: true };
  if (quote.kind === 'guide') return { text: 'Guide price', solid: false };
  if (quote.kind === 'visit') return { text: 'Free visit', solid: false };
  return null;
}

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const auth = await requireLite();
  if (!auth.ok) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{auth.error}</p>
        <Link href={litePaths.leads} className="text-sm font-medium">
          Leads
        </Link>
      </div>
    );
  }

  const [detail, products] = await Promise.all([
    getLeadDetail(auth.ctx.tenantId, id),
    getTenantProducts(),
  ]);
  if (!detail) notFound();
  const { lead } = detail;
  const showRounds = products.hasRounds && lead.status === 'won';
  const customerName = showRounds ? await linkedCustomerName(auth.ctx.tenantId, lead.convertedCustomerId) : null;

  const quote = quoteTag(lead.quote);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="min-w-0 space-y-3">
        <Link
          href={litePaths.leads}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Leads
        </Link>
        <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-card p-4 shadow-(--look-card-shadow) sm:p-5">
          <Avatar name={lead.name} tone="lite" size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight break-words">{lead.name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <Tag tone={STATUS_TONE[lead.status] ?? 'slate'}>{STATUS_LABEL[lead.status]}</Tag>
              {quote ? (
                <Tag
                  tone="lite"
                  className={quote.solid ? undefined : 'border border-(--tone-lite-solid) bg-transparent'}
                >
                  {quote.text}
                </Tag>
              ) : null}
              <span className="text-sm text-muted-foreground">{cameIn(lead.createdAt)}</span>
            </div>
          </div>
          <LeadStatusControl lead={lead} locked={false} />
        </div>
      </header>

      {lead.flags.followUpProblem ? <FollowUpBanner problem={lead.flags.followUpProblem} /> : null}

      <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <LookCard title="Conversation" icon={MessagesSquare} tone="lite">
            {detail.conversation ? (
              <ConversationTranscript
                className="mt-0"
                summary={detail.conversation.summary}
                tags={detail.conversation.tags}
                messages={detail.conversation.messages}
                status={detail.conversation.status}
              />
            ) : (
              <p className="text-sm text-muted-foreground">No conversation saved for this lead.</p>
            )}
          </LookCard>
          <TextsTimeline texts={detail.texts} firstName={lead.firstName} />
        </div>
        <div className="min-w-0 space-y-5">
          <CustomerCard lead={lead} />
          <JobCard lead={lead} />
          {lead.status === 'won' ? (
            <BookedForEditor key={`${lead.bookedForDate ?? ''}|${lead.bookedForTime ?? ''}`} lead={lead} />
          ) : null}
          <div id="lead-rounds-actions" className="empty:hidden">
            {showRounds ? <RoundsActions lead={lead} customerName={customerName} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
