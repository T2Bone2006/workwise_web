import Link from 'next/link';
import { PageGradientHeader } from '@/components/layout/page-gradient-header';
import { CopySnippet } from '@/components/lite/copy-snippet';
import { SetupBanner } from '@/components/lite/setup-banner';
import { LookForm } from '@/components/lite/widget/look-form';
import { StatusCard } from '@/components/lite/widget/status-card';
import { TextsForm } from '@/components/lite/widget/texts-form';
import { WebsiteForm } from '@/components/lite/widget/website-form';
import { WidgetPreview } from '@/components/lite/widget-preview';
import { TextsMeter } from '@/components/messaging/texts-meter';
import { getTextUsage } from '@/lib/data/messaging/texts';
import { getSetupStatus } from '@/lib/lite/setup-status';
import { getWidgetSettings } from '@/lib/lite/widget-settings';
import type { Stage } from '@/lib/lite/interview-schema';
import { parseProfile } from '@/lib/lite/profile-schema';
import { requireLite } from '@/lib/lite/require-lite';
import { litePaths, widgetSnippet } from '@/lib/navigation/lite-paths';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';

async function starterPrompts(tenantId: string): Promise<string[]> {
  const { data } = await createAdminClient().from('lite_price_profiles').select('profile').eq('tenant_id', tenantId).maybeSingle();
  const parsed = parseProfile((data as { profile?: unknown } | null)?.profile);
  if (!parsed) return [];
  return parsed.job_types.slice(0, 2).map((job) => `I need ${job.name.toLowerCase()}`);
}

export default async function LiteWidgetPage() {
  const auth = await requireLite();
  if (!auth.ok) {
    return (
      <div className="flex min-w-0 flex-col gap-4">
        <PageGradientHeader
          title="Widget"
          subtitle="Is your assistant working, and how do you set it up the way you want?"
        />
        <p className="text-sm text-muted-foreground">{auth.error}</p>
      </div>
    );
  }

  const admin = createAdminClient();
  let settings: Awaited<ReturnType<typeof getWidgetSettings>> | null = null;
  let loadError: string | null = null;
  try {
    settings = await getWidgetSettings(admin, auth.ctx);
  } catch {
    loadError = "Couldn't load your website chat.";
  }
  const prompts = await starterPrompts(auth.ctx.tenantId);
  let setupStage: Stage | undefined;
  if (settings && !settings.setupLive) {
    try {
      const setup = await getSetupStatus(admin, auth.ctx.tenantId);
      if (setup.state === 'in_progress') setupStage = setup.stage;
    } catch {
      setupStage = undefined;
    }
  }
  let usage: Awaited<ReturnType<typeof getTextUsage>> | null = null;
  if (settings?.setupLive) {
    try {
      usage = await getTextUsage(await createClient(), auth.ctx.tenantId);
    } catch {
      usage = null;
    }
  }

  const snippet = widgetSnippet(settings?.id ?? auth.ctx.widget.id);
  const subject = encodeURIComponent(`Website chat code for ${auth.ctx.widget.business_name}`);
  const body = encodeURIComponent(`${snippet}\n\nPaste this just before </body> on every page.`);
  const greeting = settings?.greeting ?? 'Hi! What type of job do you need help with today?';
  const colour = settings?.primaryColour ?? '#0C66E4';

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <PageGradientHeader
        title="Widget"
        subtitle={
          settings?.setupLive
            ? 'Paste the code on your site. This page tells you whether anyone has opened the chat there.'
            : 'The chat that will sit on your website, once setup is finished.'
        }
        actions={
          settings?.setupLive ? (
            <Button variant="outline" size="sm" asChild className="bg-background">
              <Link href={litePaths.pricing}>How you price</Link>
            </Button>
          ) : null
        }
      />
      {loadError || !settings ? <p className="text-sm text-destructive">{loadError ?? "Couldn't load your website chat."}</p> : null}
      {settings && !settings.setupLive ? <SetupBanner stage={setupStage} /> : null}
      {settings?.setupLive ? (
        <StatusCard
          active={settings.active}
          website={settings.website}
          setupLive={settings.setupLive}
          seenOnWebsite={settings.seenOnWebsite}
          last7Days={settings.last7Days}
        />
      ) : null}
      {settings?.setupLive ? (
        <TextsForm
          key={`${settings.signOffName}|${settings.ownerMobileDisplay}|${settings.followUpEnabled}|${settings.textMeToo}|${settings.notificationEmail}`}
          businessName={auth.ctx.widget.business_name}
          trade={auth.ctx.widget.trade}
          signOffName={settings.signOffName}
          ownerMobileDisplay={settings.ownerMobileDisplay}
          followUpEnabled={settings.followUpEnabled}
          textMeToo={settings.textMeToo}
          notificationEmail={settings.notificationEmail}
        />
      ) : null}
      {settings?.setupLive ? (
        <>
          <section className="glass-card min-w-0 space-y-3 rounded-xl p-4 sm:p-5">
            <h2 className="text-base font-semibold">1. Put this on your website</h2>
            <p className="text-sm text-muted-foreground">
              Paste it just before &lt;/body&gt; on every page, or in the custom-code box. Until that is done, the chat is not on any site.
            </p>
            <CopySnippet snippet={snippet} />
            <Button variant="outline" size="sm" asChild>
              <a href={`mailto:?subject=${subject}&body=${body}`}>Email it</a>
            </Button>
          </section>
          <WebsiteForm key={settings.website ?? ''} website={settings.website} />
          <LookForm key={`${settings.primaryColour}|${settings.greeting}`} primaryColour={settings.primaryColour} greeting={settings.greeting} />
          <section className="glass-card space-y-3 rounded-xl p-4 sm:p-5">
            <h2 className="text-base font-semibold">Texts left this month</h2>
            {usage ? <TextsMeter usage={usage} /> : <p className="text-sm text-muted-foreground">Texts left couldn&apos;t be loaded.</p>}
          </section>
        </>
      ) : null}
      <section className="glass-card min-w-0 space-y-3 rounded-xl p-4 sm:p-5">
        <h2 className="text-base font-semibold">Try the chat here</h2>
        <p className="text-sm text-muted-foreground">This is only a preview inside WorkWise. It does not mean the chat is on your website.</p>
        {settings && !settings.setupLive ? (
          <p className="text-sm text-muted-foreground">
            Have a go. It won&apos;t know your prices until you finish the interview, so this is only a preview.
          </p>
        ) : null}
        <WidgetPreview
          source="live"
          businessName={auth.ctx.widget.business_name}
          greeting={greeting}
          primaryColour={colour}
          starterPrompts={prompts}
        />
      </section>
    </div>
  );
}
