import { PageGradientHeader } from '@/components/layout/page-gradient-header';
import { SetupFlow } from '@/components/lite/setup/setup-flow';
import { getOrStartInterview } from '@/lib/lite/interview';
import { parseProfile } from '@/lib/lite/profile-schema';
import { requireLite } from '@/lib/lite/require-lite';
import { getSetupStatus } from '@/lib/lite/setup-status';
import { widgetSnippet } from '@/lib/navigation/lite-paths';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatUkPhoneDisplay } from '@/lib/utils/phone';

const DEFAULT_GREETING = 'Hi! What type of job do you need help with today?';
const DEFAULT_COLOUR = '#0C66E4';

async function firstName(admin: ReturnType<typeof createAdminClient>, userId: string): Promise<string> {
  const { data } = await admin.from('users').select('full_name').eq('id', userId).maybeSingle();
  const name = (data as { full_name?: unknown } | null)?.full_name;
  const full = typeof name === 'string' ? name.trim() : '';
  return (full.split(/\s+/)[0] ?? '').slice(0, 40);
}

async function widgetLook(admin: ReturnType<typeof createAdminClient>, widgetId: string) {
  const { data } = await admin
    .from('widget_clients')
    .select('greeting, primary_colour, website_url, sign_off_name, owner_mobile_e164')
    .eq('id', widgetId)
    .maybeSingle();
  const row = data as {
    greeting?: unknown;
    primary_colour?: unknown;
    website_url?: unknown;
    sign_off_name?: unknown;
    owner_mobile_e164?: unknown;
  } | null;
  const website = typeof row?.website_url === 'string' ? row.website_url.trim() : '';
  const signOff = typeof row?.sign_off_name === 'string' ? row.sign_off_name.trim() : '';
  const mobile = typeof row?.owner_mobile_e164 === 'string' ? formatUkPhoneDisplay(row.owner_mobile_e164) : '';
  return {
    greeting: typeof row?.greeting === 'string' && row.greeting.trim() !== '' ? row.greeting : DEFAULT_GREETING,
    primaryColour: typeof row?.primary_colour === 'string' && row.primary_colour.trim() !== '' ? row.primary_colour : DEFAULT_COLOUR,
    website,
    signOff,
    mobile,
  };
}

async function livePrompts(admin: ReturnType<typeof createAdminClient>, tenantId: string): Promise<string[]> {
  const { data } = await admin.from('lite_price_profiles').select('profile').eq('tenant_id', tenantId).maybeSingle();
  const parsed = parseProfile((data as { profile?: unknown } | null)?.profile);
  if (!parsed) return [];
  return parsed.job_types.slice(0, 2).map((job) => `I need ${job.name.toLowerCase()}`);
}

export default async function LiteSetupPage() {
  const auth = await requireLite();
  if (!auth.ok) {
    return (
      <div className="flex w-full min-w-0 flex-col gap-4">
        <PageGradientHeader
          title="Set up your website assistant"
          subtitle="About 10–15 minutes. Stop any time — it saves as you go."
        />
        <p className="text-sm text-muted-foreground">Your website assistant isn&apos;t ready yet.</p>
      </div>
    );
  }

  const admin = createAdminClient();
  const [status, look, name] = await Promise.all([
    getSetupStatus(admin, auth.ctx.tenantId),
    widgetLook(admin, auth.ctx.widget.id),
    firstName(admin, auth.ctx.userId),
  ]);
  const snippet = widgetSnippet(auth.ctx.widget.id);
  const shared = {
    businessName: auth.ctx.widget.business_name,
    greeting: look.greeting,
    primaryColour: look.primaryColour,
    snippet,
    initialWebsite: look.website,
    initialSignOff: look.signOff || name,
    initialMobile: look.mobile,
  };

  if (status.state === 'live' && !status.redoInProgress) {
    const starterPrompts = await livePrompts(admin, auth.ctx.tenantId);
    return <SetupFlow phase="done" starterPrompts={starterPrompts} {...shared} />;
  }

  const view = await getOrStartInterview(admin, auth.ctx);
  return <SetupFlow phase="interview" view={view} starterPrompts={[]} {...shared} />;
}
