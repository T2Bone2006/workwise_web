import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExpenseCategory } from '@/lib/books/categories';
import { isExpenseCategory } from '@/lib/books/categories';
import type { Ymd } from '@/lib/rounds/dates';

export type ExpenseRow = {
  id: string;
  status: 'draft' | 'confirmed';
  spentOn: Ymd | null;
  merchant: string | null;
  category: ExpenseCategory | null;
  amount: number | null;
  vatAmount: number | null;
  note: string | null;
  hasReceipt: boolean;
  source: 'receipt_scan' | 'manual';
  aiConfidence: number | null;
  createdAt: string;
};

const COLUMNS =
  'id, status, spent_on, merchant, category, amount, vat_amount, note, receipt_path, source, ai_confidence, created_at';

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toRow(r: Record<string, unknown>): ExpenseRow {
  return {
    id: String(r.id),
    status: r.status === 'draft' ? 'draft' : 'confirmed',
    spentOn: typeof r.spent_on === 'string' ? r.spent_on : null,
    merchant: typeof r.merchant === 'string' ? r.merchant : null,
    category: isExpenseCategory(r.category) ? r.category : null,
    amount: num(r.amount),
    vatAmount: num(r.vat_amount),
    note: typeof r.note === 'string' ? r.note : null,
    hasReceipt: typeof r.receipt_path === 'string' && r.receipt_path !== '',
    source: r.source === 'receipt_scan' ? 'receipt_scan' : 'manual',
    aiConfidence: num(r.ai_confidence),
    createdAt: String(r.created_at),
  };
}

/** To check: scanned expenses waiting for a Save. Newest first, max 100. */
export async function listDraftExpenses(db: SupabaseClient, tenantId: string): Promise<ExpenseRow[]> {
  const { data, error } = await db
    .from('expenses')
    .select(COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new Error('Could not load expenses to check');
  return (data ?? []).map((r) => toRow(r as Record<string, unknown>));
}

/** Saved expenses only (drafts never count), spent in the range, newest first. */
export async function listExpenses(
  db: SupabaseClient,
  tenantId: string,
  range: { from: Ymd; to: Ymd },
): Promise<ExpenseRow[]> {
  const { data, error } = await db
    .from('expenses')
    .select(COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('status', 'confirmed')
    .gte('spent_on', range.from)
    .lte('spent_on', range.to)
    .order('spent_on', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(5000);
  if (error) throw new Error('Could not load expenses');
  return (data ?? []).map((r) => toRow(r as Record<string, unknown>));
}

export async function getExpense(
  db: SupabaseClient,
  tenantId: string,
  id: string,
): Promise<ExpenseRow | null> {
  const { data, error } = await db
    .from('expenses')
    .select(COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error('Could not load that expense');
  return data ? toRow(data as Record<string, unknown>) : null;
}

/** Whether the business is VAT registered (hides VAT fields on the Expenses page when not). */
export async function getVatRegistered(db: SupabaseClient, tenantId: string): Promise<boolean> {
  const { data } = await db
    .from('tenant_payment_settings')
    .select('vat_registered')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  return (data as { vat_registered?: boolean } | null)?.vat_registered === true;
}
