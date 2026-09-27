import type { SupabaseClient } from '@supabase/supabase-js';
import { roundMoney } from '@/lib/money/pence';
import { todayInLondon } from '@/lib/rounds/dates';

export type InvoiceRecord = {
  id: string;
  tenantId: string;
  customerId: string;
  number: string;
  kind: 'visit' | 'balance';
  status: 'issued' | 'void';
  issueDate: string;
  dueDate: string;
  seller: {
    name: string;
    address: string | null;
    phone: string | null;
    email: string | null;
    logoUrl: string | null;
    vatNumber: string | null;
  };
  billTo: {
    name: string;
    company: string | null;
    address: string | null;
    email: string | null;
  };
  bank: { accountName: string; sortCode: string; accountNumber: string } | null;
  paymentReference: string | null;
  vatRatePercent: number | null;
  subtotalNet: number;
  vatAmount: number;
  total: number;
  footer: string | null;
  publicToken: string;
  sentAt: string | null;
  sentToEmail: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  lines: {
    jobId: string | null;
    serviceDate: string | null;
    description: string;
    address: string | null;
    amount: number;
  }[];
  /** Live: sum of current allocations on the lines' visits (capped at total). */
  paidNow: number;
  balanceDue: number;
  isOverdue: boolean;
};

const INVOICE_COLUMNS = [
  'id',
  'tenant_id',
  'customer_id',
  'number',
  'kind',
  'status',
  'issue_date',
  'due_date',
  'seller_name',
  'seller_address',
  'seller_phone',
  'seller_email',
  'seller_logo_url',
  'seller_vat_number',
  'bill_to_name',
  'bill_to_company',
  'bill_to_address',
  'bill_to_email',
  'bank_account_name',
  'bank_sort_code',
  'bank_account_number',
  'payment_reference',
  'vat_rate_percent',
  'subtotal_net',
  'vat_amount',
  'total',
  'footer',
  'public_token',
  'sent_at',
  'sent_to_email',
  'voided_at',
  'void_reason',
].join(', ');

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

function ymd(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) return null;
  const day = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

type LineDraft = InvoiceRecord['lines'][number];

function mapLine(raw: Record<string, unknown>): { invoiceId: string; line: LineDraft } | null {
  const invoiceId = asString(raw.invoice_id);
  const description = asString(raw.description);
  if (!invoiceId || !description) return null;
  const serviceDate = ymd(raw.service_date);
  return {
    invoiceId,
    line: {
      jobId: asString(raw.job_id),
      serviceDate,
      description,
      address: asString(raw.address),
      amount: roundMoney(asFiniteNumber(raw.amount) ?? 0),
    },
  };
}

function bankFrom(raw: Record<string, unknown>): InvoiceRecord['bank'] {
  const accountName = asString(raw.bank_account_name);
  const sortCode = asString(raw.bank_sort_code);
  const accountNumber = asString(raw.bank_account_number);
  if (!accountName || !sortCode || !accountNumber) return null;
  return { accountName, sortCode, accountNumber };
}

function mapInvoice(
  raw: Record<string, unknown>,
  lines: LineDraft[],
  allocatedByJob: Map<string, number>,
  today: string,
): InvoiceRecord | null {
  const id = asString(raw.id);
  const tenantId = asString(raw.tenant_id);
  const customerId = asString(raw.customer_id);
  const number = asString(raw.number);
  const kind = asString(raw.kind);
  const status = asString(raw.status);
  const issueDate = ymd(raw.issue_date);
  const dueDate = ymd(raw.due_date);
  const sellerName = asString(raw.seller_name);
  const billToName = asString(raw.bill_to_name);
  const publicToken = asString(raw.public_token);
  if (
    !id ||
    !tenantId ||
    !customerId ||
    !number ||
    (kind !== 'visit' && kind !== 'balance') ||
    (status !== 'issued' && status !== 'void') ||
    !issueDate ||
    !dueDate ||
    !sellerName ||
    !billToName ||
    !publicToken
  ) {
    return null;
  }

  const total = roundMoney(asFiniteNumber(raw.total) ?? 0);
  const jobIds = new Set(
    lines.map((line) => line.jobId).filter((jobId): jobId is string => jobId != null),
  );
  let allocated = 0;
  for (const jobId of jobIds) {
    allocated += allocatedByJob.get(jobId) ?? 0;
  }
  const paidNow = Math.min(total, roundMoney(allocated));
  const balanceDue = roundMoney(total - paidNow);

  return {
    id,
    tenantId,
    customerId,
    number,
    kind,
    status,
    issueDate,
    dueDate,
    seller: {
      name: sellerName,
      address: asString(raw.seller_address),
      phone: asString(raw.seller_phone),
      email: asString(raw.seller_email),
      logoUrl: asString(raw.seller_logo_url),
      vatNumber: asString(raw.seller_vat_number),
    },
    billTo: {
      name: billToName,
      company: asString(raw.bill_to_company),
      address: asString(raw.bill_to_address),
      email: asString(raw.bill_to_email),
    },
    bank: bankFrom(raw),
    paymentReference: asString(raw.payment_reference),
    vatRatePercent: asFiniteNumber(raw.vat_rate_percent),
    subtotalNet: roundMoney(asFiniteNumber(raw.subtotal_net) ?? 0),
    vatAmount: roundMoney(asFiniteNumber(raw.vat_amount) ?? 0),
    total,
    footer: asString(raw.footer),
    publicToken,
    sentAt: asString(raw.sent_at),
    sentToEmail: asString(raw.sent_to_email),
    voidedAt: asString(raw.voided_at),
    voidReason: asString(raw.void_reason),
    lines,
    paidNow,
    balanceDue,
    isOverdue: status === 'issued' && balanceDue > 0 && dueDate < today,
  };
}

async function assemble(
  supabase: SupabaseClient,
  rows: Record<string, unknown>[],
): Promise<InvoiceRecord[]> {
  if (rows.length === 0) return [];

  const invoiceIds = rows
    .map((row) => asString(row.id))
    .filter((id): id is string => id != null);

  const { data: lineData, error: lineError } = await supabase
    .from('invoice_lines')
    .select('invoice_id, job_id, service_date, description, address, amount, sort_order')
    .in('invoice_id', invoiceIds)
    .order('sort_order', { ascending: true });

  if (lineError) {
    console.error('assemble invoices lines failed', lineError);
    throw new Error('Could not load the invoice.');
  }

  const linesByInvoice = new Map<string, LineDraft[]>();
  const jobIds = new Set<string>();
  for (const raw of lineData ?? []) {
    const mapped = mapLine(raw as Record<string, unknown>);
    if (!mapped) continue;
    const list = linesByInvoice.get(mapped.invoiceId) ?? [];
    list.push(mapped.line);
    linesByInvoice.set(mapped.invoiceId, list);
    if (mapped.line.jobId) jobIds.add(mapped.line.jobId);
  }

  const allocatedByJob = new Map<string, number>();
  if (jobIds.size > 0) {
    const { data: allocs, error: allocError } = await supabase
      .from('payment_allocations')
      .select('job_id, amount')
      .in('job_id', [...jobIds]);
    if (allocError) {
      console.error('assemble invoices allocations failed', allocError);
      throw new Error('Could not load the invoice.');
    }
    for (const raw of allocs ?? []) {
      const row = raw as Record<string, unknown>;
      const jobId = asString(row.job_id);
      if (!jobId) continue;
      allocatedByJob.set(
        jobId,
        roundMoney((allocatedByJob.get(jobId) ?? 0) + (asFiniteNumber(row.amount) ?? 0)),
      );
    }
  }

  const today = todayInLondon();
  const records: InvoiceRecord[] = [];
  for (const raw of rows) {
    const id = asString(raw.id);
    if (!id) continue;
    const record = mapInvoice(raw, linesByInvoice.get(id) ?? [], allocatedByJob, today);
    if (record) records.push(record);
  }
  return records;
}

export async function getInvoice(
  supabase: SupabaseClient,
  tenantId: string,
  invoiceId: string,
): Promise<InvoiceRecord | null> {
  const { data, error } = await supabase
    .from('invoices')
    .select(INVOICE_COLUMNS)
    .eq('id', invoiceId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error) {
    console.error('getInvoice failed', error);
    throw new Error('Could not load the invoice.');
  }
  if (!data) return null;

  const [record] = await assemble(supabase, [data as unknown as Record<string, unknown>]);
  return record ?? null;
}

export async function listInvoices(
  supabase: SupabaseClient,
  tenantId: string,
  opts?: { customerId?: string; limit?: number },
): Promise<InvoiceRecord[]> {
  const limit = opts?.limit ?? 100;
  let query = supabase
    .from('invoices')
    .select(INVOICE_COLUMNS)
    .eq('tenant_id', tenantId)
    .order('issue_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (opts?.customerId) {
    query = query.eq('customer_id', opts.customerId);
  }

  const { data, error } = await query;
  if (error) {
    console.error('listInvoices failed', error);
    throw new Error('Could not load invoices.');
  }

  return assemble(supabase, (data ?? []) as unknown as Record<string, unknown>[]);
}
