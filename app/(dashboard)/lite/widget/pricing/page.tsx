import Link from 'next/link';
import { HistoryBackButton } from '@/components/layout/history-back-button';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';
import { ComingSoonCard } from '@/components/lite/pricing/coming-soon-card';
import { WhatItKnows } from '@/components/lite/pricing/what-it-knows';
import { Button } from '@/components/ui/button';
import { parseProfile } from '@/lib/lite/profile-schema';
import { requireLite } from '@/lib/lite/require-lite';
import { getSetupStatus } from '@/lib/lite/setup-status';
import { litePaths } from '@/lib/navigation/lite-paths';
import { createAdminClient } from '@/lib/supabase/admin';

const HEADER = {
  title: 'How you price',
  subtitle: 'What the chat will say about your prices. If a figure is wrong, redo the interview.',
};

function formatUpdated(value: unknown): string {
  if (typeof value !== 'string' || value === '') return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/London',
  }).format(date);
}

export default async function LitePricingPage() {
  const auth = await requireLite();
  if (!auth.ok) {
    return (
      <div className="flex w-full min-w-0 flex-col gap-4">
        <HistoryBackButton fallbackHref={litePaths.widget} label="Back to widget" />
        <PageGradientHeader {...HEADER} />
        <p className="text-sm text-muted-foreground">You don&apos;t have access to this.</p>
      </div>
    );
  }

  const admin = createAdminClient();
  const status = await getSetupStatus(admin, auth.ctx.tenantId);
  if (status.state !== 'live') {
    return (
      <div className="flex w-full min-w-0 flex-col gap-4">
        <HistoryBackButton fallbackHref={litePaths.widget} label="Back to widget" />
        <PageGradientHeader {...HEADER} />
        <section className="glass-card space-y-3 rounded-xl p-4">
          <p className="text-sm font-medium">How you price isn&apos;t set up yet</p>
          <Button asChild>
            <Link href={litePaths.setup}>Start the interview</Link>
          </Button>
        </section>
      </div>
    );
  }

  const { data } = await admin
    .from('lite_price_profiles')
    .select('profile, version, updated_at')
    .eq('tenant_id', auth.ctx.tenantId)
    .maybeSingle();
  const row = data as { profile?: unknown; version?: unknown; updated_at?: unknown } | null;
  const profile = parseProfile(row?.profile);
  const version = typeof row?.version === 'number' ? row.version : status.profileVersion;
  const updated = formatUpdated(row?.updated_at);

  if (!profile) {
    return (
      <div className="flex w-full min-w-0 flex-col gap-4">
        <HistoryBackButton fallbackHref={litePaths.widget} label="Back to widget" />
        <PageGradientHeader {...HEADER} />
        <section className="space-y-2 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-950 dark:text-rose-100">
          Something&apos;s wrong with your saved answers — redo the interview to fix it.
        </section>
        <ComingSoonCard redoInProgress={status.redoInProgress} />
      </div>
    );
  }

  const priced = profile.job_types.filter((job) => job.how_priced === 'from_description').length;
  const visits = profile.job_types.length - priced;
  const summary = [
    profile.job_types.length === 1 ? '1 kind of work.' : `${profile.job_types.length} kinds of work.`,
    priced === 0
      ? 'None get an estimate from a description.'
      : priced === 1
        ? '1 gets an estimate from a description.'
        : `${priced} get an estimate from a description.`,
    visits === 0 ? 'None need a look first.' : visits === 1 ? '1 needs a look first.' : `${visits} need a look first.`,
  ].join(' ');

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      <HistoryBackButton fallbackHref={litePaths.widget} label="Back to widget" />
      <PageGradientHeader {...HEADER} />
      {status.redoInProgress ? (
        <p className="rounded-xl bg-sky-500/15 px-4 py-3 text-sm text-sky-950 dark:text-sky-100">
          You&apos;re redoing the interview. Customers still get these answers until you finish.
        </p>
      ) : null}
      <p className="text-sm">{summary}</p>
      <p className="text-sm text-muted-foreground">
        Last updated {updated || '—'} · version {version}
      </p>
      <WhatItKnows profile={profile} />
      <ComingSoonCard redoInProgress={status.redoInProgress} />
    </div>
  );
}
