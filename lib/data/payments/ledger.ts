import type { SupabaseClient } from '@supabase/supabase-js';
import type { PaymentMethod } from '@/lib/payments/money-core';
import { sendsInvoice } from '@/lib/payments/terms';
import { getCustomerBalance } from '@/lib/data/payments/owed';

export type LedgerVisit = {
  jobId: string;
  date: string | null;
  title: string;
  address: string;
  due: number;
  allocated: number;
  outstanding: number;
  paymentStatus: 'unpaid' | 'partial' | 'paid' | 'waived';
};

/** Phase 4 (D12): an "other amount owed", paid by the engine like a visit. */
export type LedgerCharge = {
  chargeId: string;
  kind: 'starting_balance' | 'other';
  description: string;
  date: string;
  amount: number;
  allocated: number;
  outstanding: number;
  status: 'active' | 'void';
};

export type LedgerPayment = {
  id: string;
  amount: number;
  refundedAmount: number;
  method: PaymentMethod;
  source: 'manual' | 'stripe' | 'open_banking' | 'gocardless';
  status: 'active' | 'void';
  receivedAt: string;
  note: string | null;
  appliesToJobId: string | null;
  invoiceId: string | null;
  disputedAt: string | null;
  disputeStatus: string | null;
  voidReason: string | null;
  allocations: { jobId: string; amount: number }[];
};

export type CustomerLedger = {
  customer: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    paymentTerms: 'on_the_day' | 'invoice';
    reference: string | null;
    payLinkToken: string | null;
    preferredChannel: string | null;
  };
  balance: {
    owedAmount: number;
    unpaidVisitCount: number;
    oldestUnpaidDate: string | null;
    creditAmount: number;
    otherOwedAmount: number;
  };
  /** Active charges, newest date first. */
  charges: LedgerCharge[];
  unpaidVisits: LedgerVisit[];
  recentVisits: LedgerVisit[];
  payments: LedgerPayment[];
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

function visitTitle(raw: Record<string, unknown>): string {
  const cf = raw.custom_fields;
  if (cf && typeof cf === 'object' && !Array.isArray(cf)) {
    const rounds = (cf as { rounds?: unknown }).rounds;
    if (rounds && typeof rounds === 'object' && !Array.isArray(rounds)) {
      const name = (rounds as { service_name?: unknown }).service_name;
      if (typeof name === 'string' && name.trim() !== '') return name.trim();
    }
  }
  return asString(raw.job_description) ?? 'Visit';
}

function visitAddress(raw: Record<string, unknown>): string {
  const address = asString(raw.address) ?? '';
  const postcode = asString(raw.postcode);
  return postcode ? `${address}, ${postcode}` : address;
}

function mapVisit(
  raw: Record<string, unknown>,
  allocatedByJob: Map<string, number>,
): LedgerVisit | null {
  const jobId = asString(raw.id);
  const status = asString(raw.payment_status);
  if (!jobId || !status) return null;
  if (!['unpaid', 'partial', 'paid', 'waived'].includes(status)) return null;

  const due = Math.round(
    (asFiniteNumber(raw.final_amount) ??
      asFiniteNumber(raw.quoted_amount) ??
      0) * 100,
  ) / 100;
  const allocated = allocatedByJob.get(jobId) ?? 0;
  const outstanding = Math.max(0, Math.round((due - allocated) * 100) / 100);
  const date =
    asString(raw.scheduled_date)?.slice(0, 10) ??
    (asString(raw.completed_at)
      ? asString(raw.completed_at)!.slice(0, 10)
      : null);

  return {
    jobId,
    date,
    title: visitTitle(raw),
    address: visitAddress(raw),
    due,
    allocated,
    outstanding,
    paymentStatus: status as LedgerVisit['paymentStatus'],
  };
}

function mapCharge(
  raw: Record<string, unknown>,
  allocatedByCharge: Map<string, number>,
): LedgerCharge | null {
  const chargeId = asString(raw.id);
  const kind = asString(raw.kind);
  const description = asString(raw.description);
  const date = asString(raw.charge_date)?.slice(0, 10) ?? null;
  const status = asString(raw.status);
  const amount = asFiniteNumber(raw.amount);
  if (!chargeId || !description || !date || amount == null) return null;
  if (kind !== 'starting_balance' && kind !== 'other') return null;
  if (status !== 'active' && status !== 'void') return null;

  const allocated = allocatedByCharge.get(chargeId) ?? 0;
  return {
    chargeId,
    kind,
    description,
    date,
    amount,
    allocated,
    outstanding: Math.max(0, Math.round((amount - allocated) * 100) / 100),
    status,
  };
}

function mapPayment(raw: Record<string, unknown>): LedgerPayment | null {
  const id = asString(raw.id);
  const method = asString(raw.method) as PaymentMethod | null;
  const source = asString(raw.source) as LedgerPayment['source'] | null;
  const status = asString(raw.status) as LedgerPayment['status'] | null;
  const receivedAt = asString(raw.received_at);
  const amount = asFiniteNumber(raw.amount);
  if (!id || !method || !source || !status || !receivedAt || amount == null) {
    return null;
  }

  const allocations: { jobId: string; amount: number }[] = [];
  const embed = raw.payment_allocations;
  const list = Array.isArray(embed)
    ? embed
    : embed
      ? [embed]
      : [];
  for (const a of list) {
    if (!a || typeof a !== 'object') continue;
    const jobId = asString((a as { job_id?: unknown }).job_id);
    const amt = asFiniteNumber((a as { amount?: unknown }).amount);
    if (jobId && amt != null) allocations.push({ jobId, amount: amt });
  }

  return {
    id,
    amount,
    refundedAmount: asFiniteNumber(raw.refunded_amount) ?? 0,
    method,
    source,
    status,
    receivedAt,
    note: asString(raw.note),
    appliesToJobId: asString(raw.applies_to_job_id),
    invoiceId: asString(raw.invoice_id),
    disputedAt: asString(raw.disputed_at),
    disputeStatus: asString(raw.dispute_status),
    voidReason: asString(raw.void_reason),
    allocations,
  };
}

export async function getCustomerLedger(
  supabase: SupabaseClient,
  tenantId: string,
  customerId: string,
): Promise<{ ledger: CustomerLedger | null; error: string | null }> {
  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select(
      'id, name, email, phone, payment_terms, bank_reference_hint, pay_link_token, preferred_channel',
    )
    .eq('id', customerId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (customerError) {
    return { ledger: null, error: customerError.message };
  }
  if (!customer) {
    return { ledger: null, error: 'Customer not found.' };
  }

  const c = customer as Record<string, unknown>;
  const name = asString(c.name);
  const id = asString(c.id);
  if (!name || !id) {
    return { ledger: null, error: 'Customer not found.' };
  }

  const [
    balance,
    { data: visitsData, error: visitsError },
    { data: paymentsData, error: paymentsError },
    { data: allocData },
    { data: chargesData, error: chargesError },
  ] = await Promise.all([
    getCustomerBalance(supabase, tenantId, customerId),
    supabase
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
          'status',
        ].join(', '),
      )
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .eq('status', 'completed')
      .not('payment_status', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(50),
    supabase
      .from('payments')
      .select(
        [
          'id',
          'amount',
          'refunded_amount',
          'method',
          'source',
          'status',
          'received_at',
          'note',
          'applies_to_job_id',
          'invoice_id',
          'disputed_at',
          'dispute_status',
          'void_reason',
          'payment_allocations ( job_id, amount )',
        ].join(', '),
      )
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .order('received_at', { ascending: false })
      .limit(50),
    supabase
      .from('payment_allocations')
      .select('job_id, charge_id, amount, payments!inner ( customer_id )')
      .eq('tenant_id', tenantId)
      .eq('payments.customer_id', customerId),
    supabase
      .from('customer_charges')
      .select('id, kind, description, amount, charge_date, status, created_at')
      .eq('tenant_id', tenantId)
      .eq('customer_id', customerId)
      .eq('status', 'active')
      .order('charge_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  if (visitsError) {
    return { ledger: null, error: visitsError.message };
  }
  if (paymentsError) {
    return { ledger: null, error: paymentsError.message };
  }
  if (chargesError) {
    return { ledger: null, error: chargesError.message };
  }

  const allocatedByJob = new Map<string, number>();
  const allocatedByCharge = new Map<string, number>();
  for (const raw of allocData ?? []) {
    const row = raw as unknown as Record<string, unknown>;
    const jobId = asString(row.job_id);
    const chargeId = asString(row.charge_id);
    const amount = asFiniteNumber(row.amount) ?? 0;
    if (jobId) {
      allocatedByJob.set(jobId, (allocatedByJob.get(jobId) ?? 0) + amount);
    } else if (chargeId) {
      allocatedByCharge.set(chargeId, (allocatedByCharge.get(chargeId) ?? 0) + amount);
    }
  }

  const charges: LedgerCharge[] = [];
  for (const raw of chargesData ?? []) {
    const charge = mapCharge(
      raw as unknown as Record<string, unknown>,
      allocatedByCharge,
    );
    if (charge) charges.push(charge);
  }

  const allVisits: LedgerVisit[] = [];
  for (const raw of visitsData ?? []) {
    const visit = mapVisit(
      raw as unknown as Record<string, unknown>,
      allocatedByJob,
    );
    if (visit) allVisits.push(visit);
  }

  const unpaidVisits = allVisits
    .filter((v) => v.paymentStatus === 'unpaid' || v.paymentStatus === 'partial')
    .sort((a, b) => {
      if (a.date == null && b.date != null) return 1;
      if (a.date != null && b.date == null) return -1;
      if (a.date && b.date && a.date !== b.date) {
        return a.date < b.date ? -1 : 1;
      }
      return a.jobId.localeCompare(b.jobId);
    });

  const recentVisits = allVisits.slice(0, 10);

  const payments: LedgerPayment[] = [];
  for (const raw of paymentsData ?? []) {
    const payment = mapPayment(raw as unknown as Record<string, unknown>);
    if (payment) payments.push(payment);
  }

  const paymentTerms = sendsInvoice(asString(c.payment_terms))
    ? 'invoice'
    : 'on_the_day';

  return {
    ledger: {
      customer: {
        id,
        name,
        email: asString(c.email),
        phone: asString(c.phone),
        paymentTerms,
        reference: asString(c.bank_reference_hint),
        payLinkToken: asString(c.pay_link_token),
        preferredChannel: asString(c.preferred_channel),
      },
      balance,
      charges,
      unpaidVisits,
      recentVisits,
      payments,
    },
    error: null,
  };
}
