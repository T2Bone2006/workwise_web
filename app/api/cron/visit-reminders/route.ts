import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isAuthorisedCronRequest } from '@/lib/cron/auth';
import { listRoundsTenantIds } from '@/lib/messaging/rounds-tenants';
import { runRemindersForTenant } from '@/lib/messaging/run-reminders';
import { runChasersForTenant } from '@/lib/messaging/run-chasers';
import { sendWaitingVisitDoneNotices } from '@/lib/payments/notify';

export const maxDuration = 300;

type ReminderTotals = {
  planned: number;
  sent: number;
  held: number;
  duplicate: number;
  skippedNoTexts: number;
  skipped: number;
  failed: number;
};

type ChaserTotals = {
  planned: number;
  sent: number;
  held: number;
  duplicate: number;
  skipped: number;
  failed: number;
};

function emptyReminders(): ReminderTotals {
  return {
    planned: 0,
    sent: 0,
    held: 0,
    duplicate: 0,
    skippedNoTexts: 0,
    skipped: 0,
    failed: 0,
  };
}

function emptyChasers(): ChaserTotals {
  return {
    planned: 0,
    sent: 0,
    held: 0,
    duplicate: 0,
    skipped: 0,
    failed: 0,
  };
}

/**
 * Evening: reminders for visits N days ahead + payment chasers.
 * Daily cron ~17:00 UTC (6pm BST / 5pm GMT). Rounds tenants only.
 */
export async function GET(request: Request) {
  if (!isAuthorisedCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const admin = createAdminClient();
  let tenantIds: string[];
  try {
    tenantIds = await listRoundsTenantIds(admin);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const now = new Date();
  const reminders = emptyReminders();
  const chasers = emptyChasers();
  const errors: { tenantId: string; error: string }[] = [];
  let visitDoneCatchUp = 0;

  for (const tenantId of tenantIds) {
    try {
      const r = await runRemindersForTenant(admin, tenantId, now);
      reminders.planned += r.planned;
      reminders.sent += r.sent;
      reminders.held += r.held;
      reminders.duplicate += r.duplicate;
      reminders.skippedNoTexts += r.skippedNoTexts;
      reminders.skipped += r.skipped;
      reminders.failed += r.failed;

      // Visit-done for stops left part-done (a service moved to another day).
      const caughtUp = await sendWaitingVisitDoneNotices(admin, { tenantId, now });
      visitDoneCatchUp += caughtUp.sent;

      const c = await runChasersForTenant(admin, tenantId, now);
      chasers.planned += c.planned;
      chasers.sent += c.sent;
      chasers.held += c.held;
      chasers.duplicate += c.duplicate;
      chasers.skipped += c.skipped;
      chasers.failed += c.failed;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error('[visit-reminders] tenant', tenantId, err);
      errors.push({ tenantId, error });
    }
  }

  return NextResponse.json({
    tenants: tenantIds.length,
    visitDoneCatchUp,
    reminders,
    chasers,
    errors,
  });
}
