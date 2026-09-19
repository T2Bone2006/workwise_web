import { createClient } from '@/lib/supabase/server';
import {
  AGREEMENT_COLUMNS,
  mapAgreementRow,
  type AgreementRow,
} from '@/lib/rounds/generate-visits';

export type AgreementListRow = AgreementRow & {
  service_name: string | null;
  customer_name: string;
};

function embedName(value: unknown): string | null {
  if (Array.isArray(value)) return embedName(value[0]);
  if (value && typeof value === 'object' && 'name' in value) {
    const name = (value as { name?: unknown }).name;
    return typeof name === 'string' && name.trim() !== '' ? name : null;
  }
  return null;
}

function toListRow(raw: Record<string, unknown>): AgreementListRow | null {
  const agreement = mapAgreementRow(raw);
  if (!agreement) return null;
  return {
    ...agreement,
    service_name: embedName(raw.service_catalog),
    customer_name: embedName(raw.customers) ?? '',
  };
}

const AGREEMENT_LIST_SELECT = `${AGREEMENT_COLUMNS}, service_catalog ( name ), customers ( name )`;

export async function getAgreementsForCustomer(
  tenantId: string,
  customerId: string,
): Promise<{ agreements: AgreementListRow[]; error: Error | null }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('service_agreements')
      .select(AGREEMENT_LIST_SELECT)
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .order('status', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[getAgreementsForCustomer]', error);
      return { agreements: [], error: new Error(error.message) };
    }

    const agreements: AgreementListRow[] = [];
    for (const row of data ?? []) {
      const mapped = toListRow(row as unknown as Record<string, unknown>);
      if (mapped) agreements.push(mapped);
    }
    return { agreements, error: null };
  } catch (err) {
    console.error('[getAgreementsForCustomer]', err);
    return {
      agreements: [],
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}

export async function getAgreementById(
  tenantId: string,
  agreementId: string,
): Promise<{ agreement: AgreementListRow | null; error: Error | null }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('service_agreements')
      .select(AGREEMENT_LIST_SELECT)
      .eq('tenant_id', tenantId)
      .eq('id', agreementId)
      .maybeSingle();

    if (error) {
      console.error('[getAgreementById]', error);
      return { agreement: null, error: new Error(error.message) };
    }
    if (!data) return { agreement: null, error: null };

    return {
      agreement: toListRow(data as unknown as Record<string, unknown>),
      error: null,
    };
  } catch (err) {
    console.error('[getAgreementById]', err);
    return {
      agreement: null,
      error: err instanceof Error ? err : new Error(String(err)),
    };
  }
}
