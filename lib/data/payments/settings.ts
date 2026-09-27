import type { SupabaseClient } from '@supabase/supabase-js';
import {
  connectStatus,
  type ConnectMirror,
  type ConnectStatus,
} from '@/lib/payments/connect-status';

export type PaymentSettings = {
  bankAccountName: string | null;
  bankSortCode: string | null;
  bankAccountNumber: string | null;
  vatRegistered: boolean;
  vatNumber: string | null;
  vatRatePercent: number;
  invoiceDueDays: number;
  invoicePrefix: string;
  invoiceFooter: string | null;
  nextInvoiceSeq: number;
  connect: {
    hasAccount: boolean;
    accountId: string | null;
    status: ConnectStatus;
    mirror: ConnectMirror | null;
    syncedAt: string | null;
  };
};

export const DEFAULT_PAYMENT_SETTINGS: Omit<PaymentSettings, 'connect'> = {
  bankAccountName: null,
  bankSortCode: null,
  bankAccountNumber: null,
  vatRegistered: false,
  vatNumber: null,
  vatRatePercent: 20,
  invoiceDueDays: 14,
  invoicePrefix: 'INV',
  invoiceFooter: null,
  nextInvoiceSeq: 1,
};

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

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

/** No row → defaults. accountId from tenants.stripe_connect_account_id. */
export async function getPaymentSettings(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<PaymentSettings> {
  const [{ data: settings }, { data: tenant }] = await Promise.all([
    supabase
      .from('tenant_payment_settings')
      .select(
        [
          'bank_account_name',
          'bank_sort_code',
          'bank_account_number',
          'vat_registered',
          'vat_number',
          'vat_rate_percent',
          'invoice_due_days',
          'invoice_prefix',
          'invoice_footer',
          'next_invoice_seq',
          'stripe_connect_charges_enabled',
          'stripe_connect_payouts_enabled',
          'stripe_connect_details_submitted',
          'stripe_connect_requirements_due',
          'stripe_connect_disabled_reason',
          'stripe_connect_synced_at',
        ].join(', '),
      )
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    supabase
      .from('tenants')
      .select('stripe_connect_account_id')
      .eq('id', tenantId)
      .maybeSingle(),
  ]);

  const accountId = asString(
    (tenant as { stripe_connect_account_id?: unknown } | null)
      ?.stripe_connect_account_id,
  );

  if (!settings) {
    return {
      ...DEFAULT_PAYMENT_SETTINGS,
      connect: {
        hasAccount: Boolean(accountId),
        accountId,
        status: connectStatus(Boolean(accountId), null),
        mirror: null,
        syncedAt: null,
      },
    };
  }

  const row = settings as unknown as Record<string, unknown>;
  const mirror: ConnectMirror = {
    stripe_connect_charges_enabled: asBool(
      row.stripe_connect_charges_enabled,
      false,
    ),
    stripe_connect_payouts_enabled: asBool(
      row.stripe_connect_payouts_enabled,
      false,
    ),
    stripe_connect_details_submitted: asBool(
      row.stripe_connect_details_submitted,
      false,
    ),
    stripe_connect_requirements_due: asStringArray(
      row.stripe_connect_requirements_due,
    ),
    stripe_connect_disabled_reason: asString(
      row.stripe_connect_disabled_reason,
    ),
  };

  return {
    bankAccountName: asString(row.bank_account_name),
    bankSortCode: asString(row.bank_sort_code),
    bankAccountNumber: asString(row.bank_account_number),
    vatRegistered: asBool(row.vat_registered, false),
    vatNumber: asString(row.vat_number),
    vatRatePercent: asFiniteNumber(row.vat_rate_percent) ?? 20,
    invoiceDueDays: asFiniteNumber(row.invoice_due_days) ?? 14,
    invoicePrefix: asString(row.invoice_prefix) ?? 'INV',
    invoiceFooter: asString(row.invoice_footer),
    nextInvoiceSeq: asFiniteNumber(row.next_invoice_seq) ?? 1,
    connect: {
      hasAccount: Boolean(accountId),
      accountId,
      status: connectStatus(Boolean(accountId), mirror),
      mirror,
      syncedAt: asString(row.stripe_connect_synced_at),
    },
  };
}

export function hasBankDetails(
  s: Pick<
    PaymentSettings,
    'bankAccountName' | 'bankSortCode' | 'bankAccountNumber'
  >,
): boolean {
  return Boolean(
    s.bankAccountName && s.bankSortCode && s.bankAccountNumber,
  );
}
