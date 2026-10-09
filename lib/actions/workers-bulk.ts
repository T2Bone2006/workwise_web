'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resend, FROM_EMAIL } from '@/lib/resend';
import { buildWorkerInviteEmail } from '@/lib/emails/worker-invite';
import { buildWorkerBusinessInviteEmail } from '@/lib/emails/worker-business-invite';
import { inviteKindFor } from '@/lib/invites/worker-invite';
import { getTenantProducts } from '@/lib/data/tenant-products';
import { countTeamWorkers } from '@/lib/data/workers';
import { allowanceFor, allowanceWithPaidFor, loadProSubscription, recordExtraWorkerConsent } from '@/lib/data/worker-allowance';
import { noticeForBatch, noticeForNextWorker, type BatchNotice } from '@/lib/billing/pro-allowance';
import { previewExtraWorkerCharge } from '@/lib/billing/extra-workers-preview';
import { reconcileExtraWorkersAfterChange } from '@/lib/billing/extra-workers';
import { lookupPostcodes } from '@/lib/utils/postcode-bulk';
import { postcodeToLatLng } from '@/lib/utils/postcode';
import { createWorkerCore, inviteWorkerCore } from '@/lib/workers/worker-create-core';
import {
  BULK_CHUNK_SIZE,
  BULK_MAX_ROWS,
  validateBulkRows,
  type BulkRow,
  type BulkRowInput,
} from '@/lib/workers/bulk-parse';

type WorkerType = 'company_subcontractor' | 'employee';

const NOT_OWNER = 'Only the account owner can add workers.';
const PLAN_UNREADABLE = "We couldn't check your plan. Please try again.";

type Gate =
  | { ok: true; tenantId: string; userId: string }
  | { ok: false; error: string };

/** Signed-in admin of a business with a Pro tier. Everything else is refused. */
async function gate(): Promise<Gate> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: NOT_OWNER };
  const { data: profile } = await supabase.from('users').select('role, tenant_id').eq('id', user.id).maybeSingle();
  if (profile?.role !== 'admin' || !profile.tenant_id) return { ok: false, error: NOT_OWNER };
  const products = await getTenantProducts();
  if (!products.isPro) return { ok: false, error: NOT_OWNER };
  return { ok: true, tenantId: profile.tenant_id as string, userId: user.id };
}

function isWorkerType(v: unknown): v is WorkerType {
  return v === 'company_subcontractor' || v === 'employee';
}

function toRows(input: ReadonlyArray<BulkRowInput & { line?: number }>): BulkRow[] {
  return input.map((r, i) => ({
    name: String(r.name ?? ''),
    phone: String(r.phone ?? ''),
    postcode: String(r.postcode ?? ''),
    email: String(r.email ?? ''),
    line: typeof r.line === 'number' ? r.line : i + 1,
    errors: [],
  }));
}

/** Allowance for the signed-in business, or null when it can't be read (callers then change nothing). */
async function readAllowance(tenantId: string, gateUsed?: (used: number) => number) {
  const row = await loadProSubscription(tenantId);
  if (!row) return null;
  const used = await countTeamWorkers(tenantId, { includePending: true });
  if (used === null) return null;
  return { row, used, allowance: await allowanceWithPaidFor(tenantId, row, used, undefined, gateUsed?.(used) ?? used) };
}

/** Same, without asking Stripe what was paid for (the chunk guard only needs the head count). */
async function readHeadcount(tenantId: string) {
  const row = await loadProSubscription(tenantId);
  if (!row) return null;
  const used = await countTeamWorkers(tenantId, { includePending: true });
  if (used === null) return null;
  return { row, used, allowance: allowanceFor(row, used) };
}

// ── check ──────────────────────────────────────────────────────────────────

export type BulkCheckResult =
  | { ok: false; error: string }
  | {
      ok: true;
      rows: Array<{ line: number; errors: string[] }>;
      validCount: number;
      /** null = no confirmation needed (fits, or a manual account). */
      notice: BatchNotice | null;
      /** Yearly only: what is charged now for the new extras (pence), from Stripe's preview; null when not yearly or unknown. */
      chargeNowPence: number | null;
      interval: 'month' | 'year' | null;
    };

/** Read-only. Checks every row on the server and works out the one confirmation for the whole batch. */
export async function checkBulkWorkers(input: { rows: BulkRowInput[]; workerType: WorkerType }): Promise<BulkCheckResult> {
  try {
    const g = await gate();
    if (!g.ok) return g;
    if (!Array.isArray(input?.rows) || input.rows.length === 0) return { ok: false, error: 'Add at least one worker.' };
    if (input.rows.length > BULK_MAX_ROWS) return { ok: false, error: `Add up to ${BULK_MAX_ROWS} workers at a time.` };
    if (!isWorkerType(input.workerType)) return { ok: false, error: 'Choose whether these are subcontractors or employees.' };

    const checked = validateBulkRows(toRows(input.rows));
    const supabase = await createClient();

    // Emails already on this team.
    const emails = checked.map((r) => r.clean?.email).filter((e): e is string => Boolean(e));
    if (emails.length > 0) {
      const { data, error } = await supabase
        .from('workers')
        .select('email')
        .eq('primary_tenant_id', g.tenantId)
        .in('email', emails);
      if (error) return { ok: false, error: PLAN_UNREADABLE };
      const taken = new Set((data ?? []).map((w) => String(w.email ?? '').toLowerCase()));
      for (const row of checked) {
        if (row.clean?.email && taken.has(row.clean.email)) {
          row.errors.push('Already on your team');
          row.clean = undefined;
        }
      }
    }

    // Postcodes: in bulk, falling back one by one. A postcode we could not check is an error, never accepted.
    const toLookup = checked.filter((r) => r.clean).map((r) => r.clean!.postcode);
    if (toLookup.length > 0) {
      let found: Map<string, unknown> | null = null;
      try {
        found = await lookupPostcodes(toLookup);
      } catch {
        found = null;
      }
      if (!found) {
        found = new Map();
        const unique = [...new Set(toLookup)];
        for (let i = 0; i < unique.length; i += 5) {
          await Promise.all(
            unique.slice(i, i + 5).map(async (pc) => {
              found!.set(pc, await postcodeToLatLng(pc));
            }),
          );
        }
      }
      for (const row of checked) {
        if (row.clean && !found.get(row.clean.postcode)) {
          row.errors.push("We couldn't find that postcode");
          row.clean = undefined;
        }
      }
    }

    const validCount = checked.filter((r) => r.clean).length;

    const read = await readAllowance(g.tenantId);
    if (!read) return { ok: false, error: PLAN_UNREADABLE };
    const notice = noticeForBatch(read.allowance, validCount);

    let chargeNowPence: number | null = null;
    let interval: 'month' | 'year' | null = null;
    if (notice) {
      const preview = await previewExtraWorkerCharge(g.tenantId, validCount);
      if (preview.ok) {
        interval = preview.interval;
        chargeNowPence = preview.chargeNowPence;
      }
    }

    return {
      ok: true,
      rows: checked.map((r) => ({ line: r.line, errors: r.errors })),
      validCount,
      notice,
      chargeNowPence,
      interval,
    };
  } catch (err) {
    console.error('[checkBulkWorkers]', err instanceof Error ? err.name : 'Error');
    return { ok: false, error: PLAN_UNREADABLE };
  }
}

// ── chunk ──────────────────────────────────────────────────────────────────

export type BulkChunkResult =
  | { ok: false; error: string; code: 'not_allowed' | 'team_changed' | 'bad_input' | 'failed' }
  | {
      ok: true;
      results: Array<{ line: number; outcome: 'invited' | 'added' | 'failed'; workerId?: string; error?: string }>;
    };

/**
 * Adds up to BULK_CHUNK_SIZE workers (the screen calls this again and again). The invite emails are NOT sent here:
 * finishBulkAdd sends them all together. `confirmedTeamSize` is the team size the owner agreed to; it can only
 * stop the server adding more, never raise a limit.
 */
export async function addBulkWorkersChunk(input: {
  rows: Array<BulkRowInput & { line: number }>;
  workerType: WorkerType;
  confirmedTeamSize: number;
}): Promise<BulkChunkResult> {
  try {
    const g = await gate();
    if (!g.ok) return { ok: false, error: g.error, code: 'not_allowed' };
    if (
      !Array.isArray(input?.rows) ||
      input.rows.length === 0 ||
      input.rows.length > BULK_CHUNK_SIZE ||
      !isWorkerType(input.workerType) ||
      !Number.isFinite(input.confirmedTeamSize)
    ) {
      return { ok: false, error: 'That batch could not be read.', code: 'bad_input' };
    }

    const checked = validateBulkRows(toRows(input.rows));
    const valid = checked.filter((r) => r.clean);

    const read = await readHeadcount(g.tenantId);
    if (!read) return { ok: false, error: PLAN_UNREADABLE, code: 'failed' };
    if (read.allowance.limited && read.used + valid.length > input.confirmedTeamSize) {
      return {
        ok: false,
        error: 'Your team changed while we were adding. Nothing more was added. Check your list and try again.',
        code: 'team_changed',
      };
    }

    const results: Array<{ line: number; outcome: 'invited' | 'added' | 'failed'; workerId?: string; error?: string }> = [];
    for (const row of checked) {
      if (!row.clean) {
        results.push({ line: row.line, outcome: 'failed', error: row.errors[0] ?? 'This row has a problem.' });
        continue;
      }
      const form = new FormData();
      form.set('full_name', row.clean.name);
      form.set('phone', row.clean.phone);
      form.set('email', row.clean.email);
      form.set('home_postcode', row.clean.postcode);
      form.set('worker_type', input.workerType);
      form.set('status', 'available');
      form.set('skills', '[]');
      const opts = { allowance: 'skip', reconcile: 'skip', recordConsent: false, sendEmail: false } as const;
      try {
        if (row.clean.email) {
          const made = await inviteWorkerCore(form, opts);
          results.push(
            made.success
              ? { line: row.line, outcome: 'invited', workerId: made.workerId }
              : { line: row.line, outcome: 'failed', error: made.error },
          );
        } else {
          const made = await createWorkerCore(form, opts);
          results.push(
            made.success
              ? { line: row.line, outcome: 'added', workerId: made.workerId }
              : { line: row.line, outcome: 'failed', error: made.error },
          );
        }
      } catch (err) {
        console.error('[addBulkWorkersChunk] row', err instanceof Error ? err.name : 'Error');
        results.push({ line: row.line, outcome: 'failed', error: "This worker couldn't be added. Please try again." });
      }
    }
    return { ok: true, results };
  } catch (err) {
    console.error('[addBulkWorkersChunk]', err instanceof Error ? err.name : 'Error');
    return { ok: false, error: PLAN_UNREADABLE, code: 'failed' };
  }
}

// ── finish ─────────────────────────────────────────────────────────────────

export type BulkFinishResult = {
  ok: boolean;
  emailed: number;
  emailFailed: Array<{ workerId: string }>;
  error?: string;
};

/**
 * Sends every invite email of the batch in one Resend batch call, records ONE consent for the whole batch and
 * updates the Stripe subscription ONCE. Never throws.
 */
export async function finishBulkAdd(input: { workerIds: string[]; confirmedTeamSize: number }): Promise<BulkFinishResult> {
  try {
    const g = await gate();
    if (!g.ok) return { ok: false, emailed: 0, emailFailed: [], error: g.error };
    const ids = [...new Set((Array.isArray(input?.workerIds) ? input.workerIds : []).filter((id) => typeof id === 'string'))].slice(
      0,
      BULK_MAX_ROWS,
    );

    const emailFailed: Array<{ workerId: string }> = [];
    let emailed = 0;

    if (ids.length > 0) {
      const admin = createAdminClient();
      const [{ data: workers }, { data: invites }, { data: tenant }] = await Promise.all([
        admin
          .from('workers')
          .select('id, full_name, email, worker_type, invite_status')
          .eq('primary_tenant_id', g.tenantId)
          .eq('invite_status', 'pending')
          .in('id', ids),
        admin.from('worker_invites').select('worker_id, token').eq('tenant_id', g.tenantId).is('used_at', null).in('worker_id', ids),
        admin.from('tenants').select('name').eq('id', g.tenantId).maybeSingle(),
      ]);
      const tokenOf = new Map((invites ?? []).map((i) => [String(i.worker_id), String(i.token)]));
      const tenantName = (tenant?.name as string | undefined) ?? 'WorkWise';

      const messages: Array<{ workerId: string; payload: { from: string; to: string; subject: string; html: string } }> = [];
      for (const w of workers ?? []) {
        const email = typeof w.email === 'string' ? w.email : '';
        const token = tokenOf.get(String(w.id));
        if (!email || !token) {
          emailFailed.push({ workerId: String(w.id) });
          continue;
        }
        const build = inviteKindFor(w.worker_type as string) === 'business' ? buildWorkerBusinessInviteEmail : buildWorkerInviteEmail;
        const { subject, html } = build({
          workerName: String(w.full_name ?? ''),
          inviteUrl: `https://app.joinworkwise.com/accept-invite?token=${token}`,
          tenantName,
        });
        messages.push({ workerId: String(w.id), payload: { from: FROM_EMAIL, to: email, subject, html } });
      }

      for (let i = 0; i < messages.length; i += 100) {
        const group = messages.slice(i, i + 100);
        try {
          const { error } = await resend.batch.send(group.map((m) => m.payload));
          if (error) {
            console.error('[finishBulkAdd] resend batch error');
            for (const m of group) emailFailed.push({ workerId: m.workerId });
          } else {
            emailed += group.length;
          }
        } catch (err) {
          console.error('[finishBulkAdd] resend batch', err instanceof Error ? err.name : 'Error');
          for (const m of group) emailFailed.push({ workerId: m.workerId });
        }
      }
    }

    // One consent for the batch, when the team went over the allowance.
    // The team is already complete here, so judge "was anything paid for?" by the team before this batch.
    const read = await readAllowance(g.tenantId, (used) => Math.max(0, used - ids.length));
    if (read && read.allowance.limited && read.used > read.allowance.included) {
      // None when the last worker was one of the extras already paid for at sign-up.
      const notice = noticeForNextWorker({ ...read.allowance, used: read.used - 1 });
      if (notice) {
        await recordExtraWorkerConsent({
          tenantId: g.tenantId,
          userId: g.userId,
          workerId: ids[ids.length - 1] ?? null,
          notice,
        });
      }
    }

    // And the Stripe extra-worker line once, for the whole batch.
    reconcileExtraWorkersAfterChange(g.tenantId);
    revalidatePath('/workers');
    return { ok: true, emailed, emailFailed };
  } catch (err) {
    console.error('[finishBulkAdd]', err instanceof Error ? err.name : 'Error');
    return { ok: false, emailed: 0, emailFailed: [], error: "We couldn't finish sending the invitations. You can resend them from the Invited tab." };
  }
}
