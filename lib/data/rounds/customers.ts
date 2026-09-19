import { createClient } from '@/lib/supabase/server';
import type { CustomerDetailRow } from '@/lib/data/customers';
import type { Ymd } from '@/lib/rounds/dates';
import { RESCHEDULE_STATUSES } from '@/lib/rounds/visit-transitions';

export type PaymentTerms = 'on_the_day' | 'monthly_invoice';
export type PreferredChannel = 'whatsapp' | 'sms' | 'email' | 'none';

export type RoundsCustomerListRow = {
  id: string;
  name: string;
  phone: string | null;
  phone_e164: string | null;
  email: string | null;
  payment_terms: PaymentTerms;
  is_active: boolean;
  agreement_count: number;
  active_agreement_count: number;
  next_visit_date: Ymd | null;
  /** Postcode of the first active agreement, if any. */
  postcode: string | null;
};

export type RoundsCustomerDetail = CustomerDetailRow & {
  phone_e164: string | null;
  preferred_channel: PreferredChannel | null;
  payment_terms: PaymentTerms;
  access_notes: string | null;
  bank_reference_hint: string | null;
  is_active: boolean;
};

type AgreementEmbed = {
  id?: unknown;
  status?: unknown;
  postcode?: unknown;
};

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function asPaymentTerms(value: unknown): PaymentTerms {
  return value === 'monthly_invoice' ? 'monthly_invoice' : 'on_the_day';
}

function asPreferredChannel(value: unknown): PreferredChannel | null {
  if (
    value === 'whatsapp' ||
    value === 'sms' ||
    value === 'email' ||
    value === 'none'
  ) {
    return value;
  }
  return null;
}

function asYmd(value: unknown): Ymd | null {
  if (typeof value !== 'string' || value.length < 10) return null;
  return value.slice(0, 10);
}

function embedList(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  if (value && typeof value === 'object') return [value as Record<string, unknown>];
  return [];
}

function jobCountFromEmbed(value: unknown): number {
  if (Array.isArray(value)) {
    const first = value[0] as { count?: number } | undefined;
    return typeof first?.count === 'number' ? first.count : 0;
  }
  if (value && typeof value === 'object' && 'count' in value) {
    const count = (value as { count?: number }).count;
    return typeof count === 'number' ? count : 0;
  }
  return 0;
}

export function summariseCustomerAgreements(agreements: AgreementEmbed[]): {
  agreement_count: number;
  active_agreement_count: number;
  postcode: string | null;
} {
  let active_agreement_count = 0;
  let postcode: string | null = null;
  for (const agreement of agreements) {
    const status = agreement.status;
    if (status === 'active') {
      active_agreement_count += 1;
      if (postcode == null) {
        postcode = asString(agreement.postcode);
      }
    }
  }
  return {
    agreement_count: agreements.length,
    active_agreement_count,
    postcode,
  };
}

export async function getRoundsCustomers(
  tenantId: string,
  filters: { search?: string; status?: 'active' | 'inactive' | 'all' } = {},
): Promise<{ customers: RoundsCustomerListRow[]; error: Error | null }> {
  try {
    const supabase = await createClient();
    const status = filters.status ?? 'active';

    let query = supabase
      .from('customers')
      .select(
        'id, name, phone, phone_e164, email, payment_terms, is_active, service_agreements(id, status, postcode)',
      )
      .eq('tenant_id', tenantId)
      .order('name');

    if (status === 'active') query = query.eq('is_active', true);
    if (status === 'inactive') query = query.eq('is_active', false);

    const search = filters.search?.trim();
    if (search) {
      const term = `%${search}%`;
      query = query.or(`name.ilike.${term},email.ilike.${term},phone.ilike.${term}`);
    }

    const { data, error } = await query;
    if (error) {
      console.error('[getRoundsCustomers]', error);
      return { customers: [], error: new Error(error.message) };
    }

    const rows = Array.isArray(data) ? data : [];
    const ids = rows
      .map((row) => (row as { id?: unknown }).id)
      .filter((id): id is string => typeof id === 'string');

    const nextByCustomer = new Map<string, Ymd>();
    if (ids.length > 0) {
      const { data: jobRows, error: jobsError } = await supabase
        .from('jobs')
        .select('customer_id, scheduled_date')
        .eq('tenant_id', tenantId)
        .in('customer_id', ids)
        .in('status', [...RESCHEDULE_STATUSES])
        .order('scheduled_date', { ascending: true });

      if (jobsError) {
        console.error('[getRoundsCustomers] next visit', jobsError);
      } else {
        for (const job of jobRows ?? []) {
          const customerId = asString((job as { customer_id?: unknown }).customer_id);
          const date = asYmd((job as { scheduled_date?: unknown }).scheduled_date);
          if (!customerId || !date || nextByCustomer.has(customerId)) continue;
          nextByCustomer.set(customerId, date);
        }
      }
    }

    const customers: RoundsCustomerListRow[] = [];
    for (const raw of rows) {
      const row = raw as Record<string, unknown>;
      const id = asString(row.id);
      const name = asString(row.name);
      if (!id || !name) continue;
      const summary = summariseCustomerAgreements(embedList(row.service_agreements));
      customers.push({
        id,
        name,
        phone: asString(row.phone),
        phone_e164: asString(row.phone_e164),
        email: asString(row.email),
        payment_terms: asPaymentTerms(row.payment_terms),
        is_active: row.is_active !== false,
        agreement_count: summary.agreement_count,
        active_agreement_count: summary.active_agreement_count,
        next_visit_date: nextByCustomer.get(id) ?? null,
        postcode: summary.postcode,
      });
    }

    return { customers, error: null };
  } catch (err) {
    console.error('[getRoundsCustomers]', err);
    return {
      customers: [],
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

export async function getRoundsCustomerById(
  tenantId: string,
  customerId: string,
): Promise<{ customer: RoundsCustomerDetail | null; error: Error | null }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('customers')
      .select(
        'id, tenant_id, name, type, email, phone, phone_e164, notes, created_at, updated_at, is_active, preferred_channel, payment_terms, access_notes, bank_reference_hint, jobs(count)',
      )
      .eq('id', customerId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (error) {
      if (error.code === 'PGRST116') return { customer: null, error: null };
      console.error('[getRoundsCustomerById]', error);
      return { customer: null, error: new Error(error.message) };
    }
    if (!data) return { customer: null, error: null };

    const row = data as Record<string, unknown>;
    const id = asString(row.id);
    const name = asString(row.name);
    const tenant = asString(row.tenant_id);
    if (!id || !name || !tenant) return { customer: null, error: null };

    const customer: RoundsCustomerDetail = {
      id,
      tenant_id: tenant,
      name,
      type: typeof row.type === 'string' ? row.type : 'individual',
      email: asString(row.email),
      phone: asString(row.phone),
      address: null,
      notes: asString(row.notes),
      created_at: typeof row.created_at === 'string' ? row.created_at : undefined,
      updated_at: typeof row.updated_at === 'string' ? row.updated_at : null,
      job_count: jobCountFromEmbed(row.jobs),
      has_portal_access: false,
      phone_e164: asString(row.phone_e164),
      preferred_channel: asPreferredChannel(row.preferred_channel),
      payment_terms: asPaymentTerms(row.payment_terms),
      access_notes: asString(row.access_notes),
      bank_reference_hint: asString(row.bank_reference_hint),
      is_active: row.is_active !== false,
    };

    return { customer, error: null };
  } catch (err) {
    console.error('[getRoundsCustomerById]', err);
    return {
      customer: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}
