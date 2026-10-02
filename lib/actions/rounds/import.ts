'use server';

import { revalidatePath } from 'next/cache';
import { ZodError } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getTenantIdForCurrentUser } from '@/lib/data/tenant';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { isTenantAdmin } from '@/lib/stripe/connect';
import { createRoundsCustomer } from '@/lib/actions/customers';
import { pauseAgreement } from '@/lib/actions/rounds/agreements';
import type { PreparedCustomerRow } from '@/lib/import/extracted-customer-row';
import { formatGbp } from '@/lib/money/pence';
import { createAgreementCore } from '@/lib/rounds/create-agreement';
import { todayInLondon, type Ymd } from '@/lib/rounds/dates';
import {
  agreementTitle,
  nameKey,
  planImportRow,
  postcodeKey,
  titleKey,
  type ImportExisting,
} from '@/lib/rounds/import-plan';
import type { AgreementValues } from '@/lib/validations/rounds/agreement';

const MAX_ROWS = 3000;
const ALREADY = 'This import is already running or done.';

export type ImportRowError = { rowIndex: number; name: string; error: string };

export type ImportRoundsResult =
  | {
      success: true;
      importId: string;
      customersCreated: number;
      customersMatched: number;
      agreementsCreated: number;
      agreementsSkipped: number;
      visitsGenerated: number;
      balancesAdded: number;
      paused: number;
      errors: ImportRowError[];
    }
  | { success: false; error: string };

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === '23505';
}

function errorText(err: unknown): string {
  if (err instanceof ZodError) return err.issues[0]?.message ?? 'Check this row';
  if (err instanceof Error && err.message) return err.message;
  return 'Could not add this customer';
}

function slice(value: string, max: number): string {
  return value.trim().slice(0, max);
}

async function requireRoundsAdmin(): Promise<
  | { success: true; tenantId: string; supabase: Awaited<ReturnType<typeof createClient>>; userId: string }
  | { success: false; error: string }
> {
  const tenantId = await getTenantIdForCurrentUser();
  if (!tenantId) return { success: false, error: 'Not signed in' };

  const products = await getTenantProducts();
  if (!products.hasRounds) return { success: false, error: 'Import is part of Rounds.' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not signed in' };
  if (!(await isTenantAdmin(supabase, user.id))) {
    return { success: false, error: 'Only the account owner can import customers.' };
  }
  return { success: true, tenantId, supabase, userId: user.id };
}

async function loadPage<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const pageSize = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) return rows;
  }
}

async function loadExisting(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
): Promise<ImportExisting> {
  const [customers, agreements] = await Promise.all([
    loadPage<{ id: string; name: string | null }>((from, to) =>
      supabase
        .from('customers')
        .select('id, name')
        .eq('tenant_id', tenantId)
        .order('id', { ascending: true })
        .range(from, to),
    ),
    loadPage<{ customer_id: string; title: string | null; postcode: string | null; status: string }>((from, to) =>
      supabase
        .from('service_agreements')
        .select('customer_id, title, postcode, status')
        .eq('tenant_id', tenantId)
        .in('status', ['active', 'paused'])
        .order('id', { ascending: true })
        .range(from, to),
    ),
  ]);

  const byId = new Map<string, ImportExisting['customers'][number]>();
  for (const customer of customers) {
    if (!customer.id) continue;
    byId.set(customer.id, { id: customer.id, nameKey: nameKey(customer.name ?? ''), postcodes: [] });
  }

  const existingAgreements: ImportExisting['agreements'] = [];
  for (const agreement of agreements) {
    const customer = byId.get(agreement.customer_id);
    if (!customer) continue;
    const postcode = agreement.postcode ?? '';
    if (postcode && !customer.postcodes.some((p) => postcodeKey(p) === postcodeKey(postcode))) {
      customer.postcodes.push(postcode);
    }
    existingAgreements.push({
      customerId: agreement.customer_id,
      titleKey: titleKey(agreement.title ?? ''),
      postcode,
      status: agreement.status,
    });
  }

  return { customers: [...byId.values()], agreements: existingAgreements };
}

function rememberCustomer(existing: ImportExisting, id: string, name: string, postcode: string) {
  let customer = existing.customers.find((c) => c.id === id);
  if (!customer) {
    customer = { id, nameKey: nameKey(name), postcodes: [] };
    existing.customers.push(customer);
  }
  if (postcode && !customer.postcodes.some((p) => postcodeKey(p) === postcodeKey(postcode))) {
    customer.postcodes.push(postcode);
  }
}

function rememberAgreement(existing: ImportExisting, customerId: string, service: string, postcode: string) {
  const key = titleKey(agreementTitle(service));
  const already = existing.agreements.some(
    (a) => a.customerId === customerId && a.titleKey === key && postcodeKey(a.postcode) === postcodeKey(postcode),
  );
  if (!already) {
    existing.agreements.push({ customerId, titleKey: key, postcode, status: 'active' });
  }
}

/**
 * Saves the reviewed rows. Safe to run twice: the import id can only be claimed
 * once, and customers already on the round are matched instead of duplicated.
 * Nobody is texted or emailed.
 */
export async function importRoundsCustomers(params: {
  importKey: string;
  rows: PreparedCustomerRow[];
  fileName: string;
  fileSha256: string | null;
  source: 'spreadsheet' | 'round_book';
}): Promise<ImportRoundsResult> {
  const ctx = await requireRoundsAdmin();
  if (!ctx.success) return ctx;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.importKey)) {
    return { success: false, error: 'Something went wrong starting the import. Refresh and try again.' };
  }
  if (params.rows.length > MAX_ROWS) {
    return { success: false, error: 'You can import up to 3,000 customers at a time.' };
  }

  const rows = params.rows.filter((row) => row.ok && (row.status === 'active' || row.status === 'paused'));
  if (rows.length === 0) return { success: false, error: 'Nothing to import.' };

  const fileSha =
    params.fileSha256 && /^[0-9a-f]{64}$/i.test(params.fileSha256) ? params.fileSha256.toLowerCase() : null;
  const startedAt = new Date().toISOString();
  const fileName = slice(params.fileName || 'import', 200) || 'import';

  // Claim first. A second click hits the primary key and stops here.
  // import_history has no UPDATE policy, so the finishing write uses the service role
  // after this tenant check — same as the jobs import's history row.
  const { error: claimError } = await ctx.supabase.from('import_history').insert({
    id: params.importKey,
    tenant_id: ctx.tenantId,
    kind: 'rounds_customers',
    file_name: fileName,
    file_sha256: fileSha,
    rows_total: rows.length,
    rows_imported: 0,
    rows_failed: 0,
    errors: [],
    started_at: startedAt,
    imported_by_user_id: ctx.userId,
  });
  if (claimError) {
    if (isUniqueViolation(claimError)) return { success: false, error: ALREADY };
    console.error('[importRoundsCustomers] claim', claimError);
    return { success: false, error: "Couldn't start the import. Try again." };
  }

  const counts = {
    customersCreated: 0,
    customersMatched: 0,
    agreementsCreated: 0,
    agreementsSkipped: 0,
    visitsGenerated: 0,
    balancesAdded: 0,
    paused: 0,
  };
  const errors: ImportRowError[] = [];
  let rowsImported = 0;
  const today: Ymd = todayInLondon();

  try {
    const existing = await loadExisting(ctx.supabase, ctx.tenantId);

    for (const row of rows) {
      try {
        const plan = planImportRow(row, existing, today);
        let customerId: string;

        if ('matchId' in plan.customer) {
          customerId = plan.customer.matchId;
          counts.customersMatched += 1;
          if (row.balanceOwed != null && row.balanceOwed > 0) {
            errors.push({
              rowIndex: row.rowIndex,
              name: row.name,
              error: 'Already here — owed amount not added',
            });
          }
        } else {
          const created = await createImportedCustomer(row);
          if (!created.ok) {
            errors.push({ rowIndex: row.rowIndex, name: row.name, error: created.error });
            continue;
          }
          customerId = created.id;
          counts.customersCreated += 1;
          rememberCustomer(existing, customerId, row.name, row.postcode);
          if (plan.balance != null && plan.balance > 0) {
            if (created.balanceSaved) counts.balancesAdded += 1;
            else {
              errors.push({
                rowIndex: row.rowIndex,
                name: row.name,
                error: `Couldn't add the ${formatGbp(plan.balance)} they owed — add it on their page.`,
              });
            }
          }
        }

        if (plan.agreement === 'skip_existing') {
          counts.agreementsSkipped += 1;
          rowsImported += 1;
          continue;
        }

        if (row.frequencyDays == null || row.frequencyDays < 1 || row.price == null) {
          errors.push({ rowIndex: row.rowIndex, name: row.name, error: 'This row is missing a price or how often.' });
          continue;
        }

        const values: AgreementValues = {
          customer_id: customerId,
          title: agreementTitle(row.service),
          address: slice(row.address, 200),
          postcode: row.postcode,
          price: row.price,
          duration_minutes: 30,
          frequency_days: row.frequencyDays,
          schedule_mode: 'fixed',
          anchor_date: plan.anchorDate,
          preferred_weekday: row.preferredWeekday,
          preferred_time: null,
          reminder_enabled: true,
          access_notes: slice(row.accessNotes, 500),
          notes: slice(row.notes, 500),
        };

        const agreement = await createAgreementCore(ctx.supabase, { tenantId: ctx.tenantId, values });
        if (!agreement.success) {
          if (agreement.error.startsWith('Agreement saved')) {
            rememberAgreement(existing, customerId, row.service, row.postcode);
          }
          errors.push({ rowIndex: row.rowIndex, name: row.name, error: agreement.error });
          continue;
        }

        rememberAgreement(existing, customerId, row.service, row.postcode);
        counts.agreementsCreated += 1;

        if (plan.pause) {
          const paused = await pauseAgreement(agreement.id, null);
          if (!paused.success) {
            counts.visitsGenerated += agreement.generated;
            errors.push({
              rowIndex: row.rowIndex,
              name: row.name,
              error: paused.error || "Couldn't pause this customer.",
            });
          } else {
            counts.paused += 1;
          }
        } else {
          counts.visitsGenerated += agreement.generated;
        }

        rowsImported += 1;
      } catch (err) {
        console.error('[importRoundsCustomers] row', row.rowIndex, err);
        errors.push({ rowIndex: row.rowIndex, name: row.name, error: errorText(err) });
      }
    }
  } catch (err) {
    console.error('[importRoundsCustomers]', err);
    errors.push({ rowIndex: -1, name: '', error: errorText(err) });
  }

  const completedAt = new Date().toISOString();
  const durationSeconds = Math.max(
    0,
    Math.round((new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000),
  );
  const rowsFailed = rows.length - rowsImported;

  const { error: finishError } = await createAdminClient()
    .from('import_history')
    .update({
      rows_imported: rowsImported,
      rows_failed: rowsFailed,
      errors,
      completed_at: completedAt,
      duration_seconds: durationSeconds,
    })
    .eq('id', params.importKey)
    .eq('tenant_id', ctx.tenantId);
  if (finishError) console.error('[importRoundsCustomers] finish', finishError);

  revalidatePath('/customers');
  revalidatePath('/calendar');
  revalidatePath('/dashboard');
  revalidatePath('/payments');

  return {
    success: true,
    importId: params.importKey,
    ...counts,
    errors,
  };
}

async function createImportedCustomer(
  row: PreparedCustomerRow,
): Promise<{ ok: true; id: string; balanceSaved: boolean } | { ok: false; error: string }> {
  const name = slice(row.name, 200);
  if (name.length < 2) return { ok: false, error: 'Name must be at least 2 characters' };

  const fd = new FormData();
  fd.set('name', name);
  fd.set('phone', row.phoneE164 ?? '');
  fd.set('email', row.email);
  fd.set('access_notes', slice(row.accessNotes, 500));
  fd.set('notes', slice(row.notes, 500));
  if (row.balanceOwed != null && row.balanceOwed > 0) {
    fd.set('owesFromBefore', String(row.balanceOwed));
  }

  try {
    const created = await createRoundsCustomer(fd);
    if (!created.success) return { ok: false, error: created.error };
    return { ok: true, id: created.id, balanceSaved: !created.warning };
  } catch (err) {
    return { ok: false, error: errorText(err) };
  }
}
