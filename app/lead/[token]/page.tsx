import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LeadLinkBody, LeadLinkMessage, LeadPageFrame } from '@/components/lite/lead-decision-form';
import { resolveLeadToken } from '@/lib/lite/action-tokens';
import { loadLeadLinkView } from '@/lib/lite/lead-link-view';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Booking request',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

type LeadPageProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ do?: string }>;
};

function intentOf(value: string | undefined): 'accept' | 'change' | 'decline' | null {
  if (value === 'accept' || value === 'change' || value === 'decline') return value;
  return null;
}

/** Reading this page never decides the lead. The decision is a button POST. */
export default async function LeadLinkPage({ params, searchParams }: LeadPageProps) {
  const { token } = await params;
  const intent = intentOf((await searchParams).do);
  const admin = createAdminClient();
  const resolved = await resolveLeadToken(admin, token);
  if (resolved === 'error') throw new Error('Could not load this link.');
  const view = await loadLeadLinkView(admin, token);
  if (view.state === 'invalid') notFound();

  if (view.state === 'expired') {
    return (
      <LeadPageFrame>
        <LeadLinkMessage title="This link has expired." body="Open WorkWise to see and decide on your leads." />
      </LeadPageFrame>
    );
  }

  if (typeof resolved !== 'object') throw new Error('Could not load this link.');

  return (
    <LeadPageFrame>
      <LeadLinkBody
        mode={view.state}
        businessName={view.business.name}
        lead={view.lead}
        leadId={resolved.leadId}
        token={view.state === 'open' ? token : null}
        intent={view.state === 'open' ? intent : null}
      />
    </LeadPageFrame>
  );
}
