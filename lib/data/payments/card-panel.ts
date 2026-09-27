import type { SupabaseClient } from '@supabase/supabase-js';
import { getPaymentSettings } from '@/lib/data/payments/settings';
import type { ConnectStatus } from '@/lib/payments/connect-status';
import { requirementLabel } from '@/lib/payments/requirement-label';

export { requirementLabel };
import {
  getPayoutSummary,
  retrieveVerifiedAccount,
  syncConnectMirror,
  type PayoutSummary,
} from '@/lib/stripe/connect';

export type CardPanelData = {
  status: ConnectStatus;
  requirementsDue: string[];
  disabledReason: string | null;
  payouts: PayoutSummary | null;
  payoutsError: boolean;
  disputes: {
    paymentId: string;
    customerId: string;
    customerName: string;
    amount: number;
    disputedAt: string;
    disputeStatus: string | null;
  }[];
};

const CLOSED_DISPUTES = new Set([
  'won',
  'lost',
  'warning_closed',
  'charge_refunded',
]);

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

async function loadOpenDisputes(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<CardPanelData['disputes']> {
  const { data, error } = await supabase
    .from('payments')
    .select('id, customer_id, amount, disputed_at, dispute_status, customers ( id, name )')
    .eq('tenant_id', tenantId)
    .not('disputed_at', 'is', null)
    .order('disputed_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('[getCardPanelData] disputes', error);
    return [];
  }

  const rows: CardPanelData['disputes'] = [];
  for (const raw of data ?? []) {
    const row = raw as Record<string, unknown>;
    const status = asString(row.dispute_status);
    if (status && CLOSED_DISPUTES.has(status)) continue;
    const paymentId = asString(row.id);
    const disputedAt = asString(row.disputed_at);
    const amount = asFiniteNumber(row.amount);
    const embed = row.customers;
    const customer = Array.isArray(embed)
      ? (embed[0] as Record<string, unknown> | undefined)
      : (embed as Record<string, unknown> | null);
    const customerId = asString(row.customer_id) ?? asString(customer?.id);
    const customerName = asString(customer?.name);
    if (!paymentId || !disputedAt || amount == null || !customerId || !customerName) continue;
    rows.push({
      paymentId,
      customerId,
      customerName,
      amount,
      disputedAt,
      disputeStatus: status,
    });
  }
  return rows;
}

export async function getCardPanelData(
  supabase: SupabaseClient,
  tenantId: string,
  opts?: { refresh?: boolean },
): Promise<CardPanelData> {
  let settings = await getPaymentSettings(supabase, tenantId);

  if (opts?.refresh && settings.connect.accountId) {
    try {
      const account = await retrieveVerifiedAccount(tenantId, settings.connect.accountId);
      await syncConnectMirror({ tenantId, account });
      settings = await getPaymentSettings(supabase, tenantId);
    } catch (error) {
      console.error('[getCardPanelData] refresh', error);
    }
  }

  const mirror = settings.connect.mirror;
  const disputes = await loadOpenDisputes(supabase, tenantId);
  const base = {
    status: settings.connect.status,
    requirementsDue: mirror?.stripe_connect_requirements_due ?? [],
    disabledReason: mirror?.stripe_connect_disabled_reason ?? null,
    disputes,
  };

  if (settings.connect.status !== 'active' || !settings.connect.accountId) {
    return { ...base, payouts: null, payoutsError: false };
  }

  try {
    const payouts = await getPayoutSummary({
      tenantId,
      accountId: settings.connect.accountId,
    });
    return { ...base, payouts, payoutsError: false };
  } catch (error) {
    console.error('[getCardPanelData] payouts', error);
    return { ...base, payouts: null, payoutsError: true };
  }
}
