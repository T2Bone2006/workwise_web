import Link from 'next/link';
import { Globe } from 'lucide-react';
import { Notice } from '@/components/look';
import { redirect } from 'next/navigation';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';
import { LeadsBoard } from '@/components/lite/leads/leads-board';
import { LiteTiles } from '@/components/lite/leads/lite-tiles';
import { SetupBanner } from '@/components/lite/setup-banner';
import { getLeadsBoard } from '@/lib/data/lite/leads-board';
import { requireLite } from '@/lib/lite/require-lite';
import { litePaths } from '@/lib/navigation/lite-paths';
import { Button } from '@/components/ui/button';

/**
 * Lite home: every enquiry from the website, in one place.
 * Booking Accept / Needs your answer / Booked are hidden for launch (lead capture only).
 * A business that has not started set-up is sent to the interview first.
 */
export default async function LiteHomePage() {
  const auth = await requireLite();
  if (!auth.ok) {
    return (
      <div className="flex flex-col gap-4">
        <PageGradientHeader title="Leads" subtitle="Enquiries from your website, ready for you to follow up." />
        <p className="text-sm text-muted-foreground">{auth.error}</p>
      </div>
    );
  }

  const data = await getLeadsBoard(auth.ctx.tenantId);
  if (data.setup.state === 'not_started') redirect(litePaths.setup);

  const website = data.setup.state === 'live' ? data.setup.website : null;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageGradientHeader
        title="Leads"
        subtitle={
          website
            ? `From the quote assistant on ${website.replace(/^https?:\/\//, '').replace(/\/$/, '')}`
            : 'Set your website in Widget to switch it on'
        }
      />
      {data.setup.state === 'in_progress' ? (
        <SetupBanner stage={data.setup.stage} />
      ) : data.setup.state === 'live' && !data.websiteSet ? (
        <Notice
          tone="amber"
          icon={Globe}
          title="Your chat isn't on a website yet"
          action={
            <Button asChild variant="outline" className="bg-card">
              <Link href={litePaths.widget}>Add your website</Link>
            </Button>
          }
        >
          Add your website address so customers can actually use it.
        </Notice>
      ) : null}
      <LiteTiles tiles={data.tiles} />
      <LeadsBoard columns={data.columns} />
    </div>
  );
}
