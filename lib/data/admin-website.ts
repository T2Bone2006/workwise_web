import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { ENTITLED_STATUSES } from '@/lib/data/tenant-products';
import {
  isWebsiteStatus,
  keepFromDate,
  shouldTakeDown,
  type LiteRunState,
  type WebsiteStatus,
} from '@/lib/website-offer';

export type SubscriptionRow = {
  tenant_id: string;
  product: string | null;
  plan: string | null;
  status: string | null;
  source: string | null;
  billing_interval: string | null;
  created_at: string | null;
  cancel_at_period_end: boolean | null;
  canceled_at: string | null;
  current_period_end: string | null;
};

const PRO_LABEL: Record<string, string> = { starter: 'Pro Starter', growth: 'Pro Growth', pro: 'Pro' };

/** "Rounds", "Lite", "Rounds + Lite" or the Pro tier, from what the business pays for. */
export function planLabel(rows: Pick<SubscriptionRow, 'product' | 'plan'>[]): string {
  const products = new Set(rows.map((r) => r.product).filter((p): p is string => !!p));
  if (rows.some((r) => r.plan === 'both') || (products.has('rounds') && products.has('lite'))) return 'Rounds + Lite';
  if (products.has('lite')) return 'Lite';
  if (products.has('rounds')) return 'Rounds';
  for (const tier of ['pro', 'growth', 'starter']) if (products.has(tier)) return PRO_LABEL[tier];
  return 'Unknown';
}

export type LiteSummary = {
  state: LiteRunState;
  startedAt: string;
  endsAt: string | null;
  keepFrom: string;
};

/** How long they have had Lite and whether it is running, ending or over. Null when they never had Lite. */
export function summariseLite(rows: SubscriptionRow[]): LiteSummary | null {
  const lite = rows.filter((r) => r.product === 'lite' && r.source === 'stripe' && r.created_at);
  if (lite.length === 0) return null;
  const startedAt = lite.map((r) => r.created_at as string).sort()[0];
  const entitled = new Set<string>(ENTITLED_STATUSES);
  const live = lite.filter((r) => r.status != null && entitled.has(r.status));
  let state: LiteRunState;
  let endsAt: string | null;
  if (live.length > 0) {
    const ending = live.every((r) => r.cancel_at_period_end === true);
    state = ending ? 'ending' : 'active';
    endsAt = ending ? (live.map((r) => r.current_period_end).filter(Boolean).sort().pop() ?? null) : null;
  } else {
    state = 'ended';
    endsAt =
      lite
        .map((r) => r.canceled_at ?? r.current_period_end)
        .filter((v): v is string => !!v)
        .sort()
        .pop() ?? null;
  }
  return { state, startedAt, endsAt, keepFrom: keepFromDate(new Date(startedAt)).toISOString() };
}

export type SignupRow = {
  tenantId: string;
  business: string;
  contactName: string | null;
  email: string | null;
  plan: string;
  interval: 'month' | 'year' | null;
  signedUpAt: string;
  closed: boolean;
  lite: LiteSummary | null;
  website: {
    status: WebsiteStatus;
    liveUrl: string | null;
    notes: string | null;
    answeredAt: string;
    doneAt: string | null;
  } | null;
  takeDown: boolean;
};

export type SignupList = { rows: SignupRow[]; error: string | null; tableMissing: boolean; now: number };

const MAX_BUSINESSES = 150;

type TenantRow = { id: string; name: string | null; closed_at: string | null };
type UserRow = { tenant_id: string | null; email: string | null; full_name: string | null; role: string | null };
type RequestRow = {
  tenant_id: string;
  status: string;
  live_url: string | null;
  notes: string | null;
  answered_at: string;
  done_at: string | null;
};

/** Newest self-serve sign-ups first, with where each Lite business is on the free website. Service role. */
export async function listSignups(): Promise<SignupList> {
  const admin = createAdminClient();

  const { data: subData, error: subError } = await admin
    .from('subscriptions')
    .select(
      'tenant_id, product, plan, status, source, billing_interval, created_at, cancel_at_period_end, canceled_at, current_period_end',
    )
    .eq('source', 'stripe')
    .order('created_at', { ascending: false })
    .limit(1000);
  if (subError || !subData) return { rows: [], error: "Couldn't read the sign-ups. Try again.", tableMissing: false, now: Date.now() };

  const byTenant = new Map<string, SubscriptionRow[]>();
  for (const row of subData as SubscriptionRow[]) {
    const list = byTenant.get(row.tenant_id) ?? [];
    list.push(row);
    byTenant.set(row.tenant_id, list);
  }
  const startOf = (rows: SubscriptionRow[]) => rows.map((r) => r.created_at ?? '').sort()[0] ?? '';
  const ids = [...byTenant.keys()]
    .sort((a, b) => startOf(byTenant.get(b) ?? []).localeCompare(startOf(byTenant.get(a) ?? [])))
    .slice(0, MAX_BUSINESSES);
  if (ids.length === 0) return { rows: [], error: null, tableMissing: false, now: Date.now() };

  const [tenants, users, requests] = await Promise.all([
    admin.from('tenants').select('id, name, closed_at').in('id', ids),
    admin.from('users').select('tenant_id, email, full_name, role').in('tenant_id', ids).eq('role', 'admin'),
    admin
      .from('website_requests')
      .select('tenant_id, status, live_url, notes, answered_at, done_at')
      .in('tenant_id', ids),
  ]);
  if (tenants.error || !tenants.data) return { rows: [], error: "Couldn't read the businesses. Try again.", tableMissing: false, now: Date.now() };
  // Until the owner pastes the migration the table does not exist: show the sign-ups without a website column.
  const tableMissing = !!requests.error;

  const tenantById = new Map((tenants.data as TenantRow[]).map((t) => [t.id, t]));
  const userByTenant = new Map<string, UserRow>();
  for (const u of (users.data ?? []) as UserRow[]) {
    if (u.tenant_id && !userByTenant.has(u.tenant_id)) userByTenant.set(u.tenant_id, u);
  }
  const requestByTenant = new Map(((requests.data ?? []) as RequestRow[]).map((r) => [r.tenant_id, r]));

  const rows: SignupRow[] = [];
  for (const id of ids) {
    const tenant = tenantById.get(id);
    const subs = byTenant.get(id) ?? [];
    if (!tenant) continue;
    const user = userByTenant.get(id);
    const request = requestByTenant.get(id);
    const lite = summariseLite(subs);
    const website =
      request && isWebsiteStatus(request.status)
        ? {
            status: request.status,
            liveUrl: request.live_url,
            notes: request.notes,
            answeredAt: request.answered_at,
            doneAt: request.done_at,
          }
        : null;
    const interval = subs.find((s) => s.billing_interval === 'year' || s.billing_interval === 'month')?.billing_interval;
    rows.push({
      tenantId: id,
      business: tenant.name?.trim() || 'Unnamed business',
      contactName: user?.full_name?.trim() || null,
      email: user?.email ?? null,
      plan: planLabel(subs),
      interval: interval === 'year' || interval === 'month' ? interval : null,
      signedUpAt: startOf(subs),
      closed: !!tenant.closed_at,
      lite,
      website,
      takeDown:
        !!website &&
        !!lite &&
        shouldTakeDown({
          status: website.status,
          lite: lite.state,
          liteStartedAt: new Date(lite.startedAt),
          liteEndsAt: lite.endsAt ? new Date(lite.endsAt) : null,
        }),
    });
  }
  return { rows, error: null, tableMissing, now: Date.now() };
}
