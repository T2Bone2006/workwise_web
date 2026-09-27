import 'server-only';

import { cache } from 'react';
import { getInvoice, type InvoiceRecord } from '@/lib/data/payments/invoices';
import {
  connectStatus,
  type ConnectMirror,
} from '@/lib/payments/connect-status';
import { createAdminClient } from '@/lib/supabase/admin';

export type PublicBusiness = {
  tenantId: string;
  name: string;
  logoUrl: string | null;
  phone: string | null;
  email: string | null;
};

export type PublicBank = {
  accountName: string;
  sortCode: string;
  accountNumber: string;
} | null;

export type CustomerPayPage = {
  business: PublicBusiness;
  customerId: string;
  customerFirstName: string | null;
  reference: string | null;
  owedAmount: number;
  creditAmount: number;
  unpaidVisits: {
    date: string | null;
    title: string;
    address: string;
    outstanding: number;
  }[];
  bank: PublicBank;
  card: { enabled: boolean };
};

const TOKEN_RE = /^[A-Za-z0-9_-]{20,80}$/;
const GREETING_TITLES = new Set(['MR', 'MRS', 'MS', 'MISS', 'DR']);

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstName(customerName: string): string | null {
  const first = customerName.trim().split(/\s+/)[0] ?? '';
  const letters = first.replace(/[^A-Za-z]/g, '');
  if (letters.length < 2) return null;
  if (GREETING_TITLES.has(letters.toUpperCase())) return null;
  return first.replace(/[^A-Za-z'-]/g, '') || null;
}

function visitTitle(raw: Record<string, unknown>): string {
  const cf = raw.custom_fields;
  if (isPlainObject(cf)) {
    const rounds = cf.rounds;
    if (isPlainObject(rounds)) {
      const name = asString(rounds.service_name);
      if (name) return name;
    }
  }
  return asString(raw.job_description) ?? 'Visit';
}

function visitAddress(raw: Record<string, unknown>): string {
  const address = asString(raw.address) ?? '';
  const postcode = asString(raw.postcode);
  return postcode ? `${address}, ${postcode}` : address;
}

function visitDate(raw: Record<string, unknown>): string | null {
  const scheduled = asString(raw.scheduled_date)?.slice(0, 10) ?? null;
  if (scheduled && /^\d{4}-\d{2}-\d{2}$/.test(scheduled)) return scheduled;
  const completed = asString(raw.completed_at)?.slice(0, 10) ?? null;
  if (completed && /^\d{4}-\d{2}-\d{2}$/.test(completed)) return completed;
  return null;
}

function companyFromSettings(settings: unknown): {
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
} {
  if (!isPlainObject(settings)) {
    return { phone: null, email: null, logoUrl: null };
  }
  const company = settings.company;
  if (!isPlainObject(company)) {
    return { phone: null, email: null, logoUrl: null };
  }
  return {
    phone: asString(company.phone),
    email: asString(company.email),
    logoUrl: asString(company.logo_url),
  };
}

function bankFromRow(row: Record<string, unknown> | null): PublicBank {
  if (!row) return null;
  const accountName = asString(row.bank_account_name);
  const sortCode = asString(row.bank_sort_code);
  const accountNumber = asString(row.bank_account_number);
  if (!accountName || !sortCode || !accountNumber) return null;
  if (!/^\d{6}$/.test(sortCode) || !/^\d{8}$/.test(accountNumber)) return null;
  return { accountName, sortCode, accountNumber };
}

function mirrorFromRow(row: Record<string, unknown> | null): ConnectMirror | null {
  if (!row) return null;
  return {
    stripe_connect_charges_enabled: asBool(row.stripe_connect_charges_enabled, false),
    stripe_connect_payouts_enabled: asBool(row.stripe_connect_payouts_enabled, false),
    stripe_connect_details_submitted: asBool(row.stripe_connect_details_submitted, false),
    stripe_connect_requirements_due: asStringArray(row.stripe_connect_requirements_due),
    stripe_connect_disabled_reason: asString(row.stripe_connect_disabled_reason),
  };
}

/** Token must match /^[A-Za-z0-9_-]{20,80}$/ before any query. null when not found. */
export const loadCustomerPayPage = cache(async function loadCustomerPayPage(
  token: string,
): Promise<CustomerPayPage | null> {
  if (!TOKEN_RE.test(token)) return null;

  const admin = createAdminClient();
  const { data: customer, error: customerError } = await admin
    .from('customers')
    .select('id, tenant_id, name, bank_reference_hint, pay_link_token')
    .eq('pay_link_token', token)
    .maybeSingle();

  if (customerError) {
    console.error('loadCustomerPayPage customer failed', customerError);
    throw new Error('Could not load this payment link.');
  }

  const customerRow = customer as Record<string, unknown> | null;
  const customerId = asString(customerRow?.id);
  const tenantId = asString(customerRow?.tenant_id);
  const customerName = asString(customerRow?.name);
  if (!customerId || !tenantId || !customerName) return null;

  const [
    { data: balance, error: balanceError },
    { data: visits, error: visitsError },
    { data: tenant, error: tenantError },
    { data: paymentSettings, error: settingsError },
  ] = await Promise.all([
    admin
      .from('customer_balances')
      .select('owed_amount, credit_amount')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .maybeSingle(),
    admin
      .from('jobs')
      .select(
        [
          'id',
          'scheduled_date',
          'completed_at',
          'job_description',
          'custom_fields',
          'address',
          'postcode',
          'final_amount',
          'quoted_amount',
          'payment_status',
        ].join(', '),
      )
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .eq('status', 'completed')
      .in('payment_status', ['unpaid', 'partial'])
      .limit(50),
    admin
      .from('tenants')
      .select('name, settings, stripe_connect_account_id')
      .eq('id', tenantId)
      .maybeSingle(),
    admin
      .from('tenant_payment_settings')
      .select(
        [
          'bank_account_name',
          'bank_sort_code',
          'bank_account_number',
          'stripe_connect_charges_enabled',
          'stripe_connect_payouts_enabled',
          'stripe_connect_details_submitted',
          'stripe_connect_requirements_due',
          'stripe_connect_disabled_reason',
        ].join(', '),
      )
      .eq('tenant_id', tenantId)
      .maybeSingle(),
  ]);

  if (balanceError || visitsError || tenantError || settingsError) {
    console.error('loadCustomerPayPage related reads failed', {
      balanceError,
      visitsError,
      tenantError,
      settingsError,
    });
    throw new Error('Could not load this payment link.');
  }

  const tenantRow = tenant as Record<string, unknown> | null;
  const businessName = asString(tenantRow?.name);
  if (!businessName) return null;

  const visitRows = (visits ?? []) as unknown as Record<string, unknown>[];
  const jobIds = visitRows
    .map((row) => asString(row.id))
    .filter((id): id is string => id != null);

  const allocatedByJob = new Map<string, number>();
  if (jobIds.length > 0) {
    const { data: allocs, error: allocError } = await admin
      .from('payment_allocations')
      .select('job_id, amount')
      .eq('tenant_id', tenantId)
      .in('job_id', jobIds);
    if (allocError) {
      console.error('loadCustomerPayPage allocations failed', allocError);
      throw new Error('Could not load this payment link.');
    }
    for (const raw of allocs ?? []) {
      const row = raw as Record<string, unknown>;
      const jobId = asString(row.job_id);
      const amount = asFiniteNumber(row.amount) ?? 0;
      if (!jobId) continue;
      allocatedByJob.set(jobId, (allocatedByJob.get(jobId) ?? 0) + amount);
    }
  }

  const unpaidVisits = visitRows
    .map((raw) => {
      const due =
        Math.round(
          (asFiniteNumber(raw.final_amount) ?? asFiniteNumber(raw.quoted_amount) ?? 0) * 100,
        ) / 100;
      const jobId = asString(raw.id);
      const allocated = jobId ? (allocatedByJob.get(jobId) ?? 0) : 0;
      const outstanding = Math.max(0, Math.round((due - allocated) * 100) / 100);
      return {
        date: visitDate(raw),
        title: visitTitle(raw),
        address: visitAddress(raw),
        outstanding,
      };
    })
    .sort((a, b) => {
      if (a.date == null && b.date != null) return 1;
      if (a.date != null && b.date == null) return -1;
      if (a.date && b.date && a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.title.localeCompare(b.title, 'en-GB');
    });

  const balanceRow = balance as Record<string, unknown> | null;
  const company = companyFromSettings(tenantRow?.settings);
  const settingsRow = paymentSettings as unknown as Record<string, unknown> | null;
  const hasAccount = Boolean(asString(tenantRow?.stripe_connect_account_id));

  return {
    business: {
      tenantId,
      name: businessName,
      logoUrl: company.logoUrl,
      phone: company.phone,
      email: company.email,
    },
    customerId,
    customerFirstName: firstName(customerName),
    reference: asString(customerRow?.bank_reference_hint),
    owedAmount: asFiniteNumber(balanceRow?.owed_amount) ?? 0,
    creditAmount: asFiniteNumber(balanceRow?.credit_amount) ?? 0,
    unpaidVisits,
    bank: bankFromRow(settingsRow),
    card: {
      enabled: connectStatus(hasAccount, mirrorFromRow(settingsRow)) === 'active',
    },
  };
});

/** Invoice link token. null when the token is malformed or unknown. */
export async function loadInvoiceByToken(
  token: string,
): Promise<{ invoice: InvoiceRecord; business: PublicBusiness; card: { enabled: boolean } } | null> {
  if (!TOKEN_RE.test(token)) return null;

  const admin = createAdminClient();
  const { data: invoiceRow, error: invoiceError } = await admin
    .from('invoices')
    .select('id, tenant_id')
    .eq('public_token', token)
    .maybeSingle();

  if (invoiceError) {
    console.error('loadInvoiceByToken invoice failed', invoiceError);
    throw new Error('Could not load this invoice.');
  }

  const row = invoiceRow as Record<string, unknown> | null;
  const invoiceId = asString(row?.id);
  const tenantId = asString(row?.tenant_id);
  if (!invoiceId || !tenantId) return null;

  const invoice = await getInvoice(admin, tenantId, invoiceId);
  if (!invoice) return null;

  const [{ data: tenant, error: tenantError }, { data: paymentSettings, error: settingsError }] =
    await Promise.all([
      admin
        .from('tenants')
        .select('name, settings, stripe_connect_account_id')
        .eq('id', tenantId)
        .maybeSingle(),
      admin
        .from('tenant_payment_settings')
        .select(
          [
            'stripe_connect_charges_enabled',
            'stripe_connect_payouts_enabled',
            'stripe_connect_details_submitted',
            'stripe_connect_requirements_due',
            'stripe_connect_disabled_reason',
          ].join(', '),
        )
        .eq('tenant_id', tenantId)
        .maybeSingle(),
    ]);

  if (tenantError || settingsError) {
    console.error('loadInvoiceByToken business failed', { tenantError, settingsError });
    throw new Error('Could not load this invoice.');
  }

  const tenantRow = tenant as Record<string, unknown> | null;
  const company = companyFromSettings(tenantRow?.settings);
  const settingsRow = paymentSettings as unknown as Record<string, unknown> | null;
  const hasAccount = Boolean(asString(tenantRow?.stripe_connect_account_id));

  return {
    invoice,
    business: {
      tenantId,
      name: asString(tenantRow?.name) ?? invoice.seller.name,
      logoUrl: company.logoUrl ?? invoice.seller.logoUrl,
      phone: company.phone ?? invoice.seller.phone,
      email: company.email ?? invoice.seller.email,
    },
    card: {
      enabled: connectStatus(hasAccount, mirrorFromRow(settingsRow)) === 'active',
    },
  };
}
