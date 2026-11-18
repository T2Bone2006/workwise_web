import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { isQuietHours, londonMonth, sendableFrom } from '@/lib/messaging/london-time';
import { listRoundsTenantIds } from '@/lib/messaging/rounds-tenants';
import { sendHeldMessages } from '@/lib/messaging/send';
import { textAllowanceFor } from '@/lib/messaging/text-allowance';
import { getSoloWorkerForTenant } from '@/lib/rounds/rounds-worker';
import { sendExpoPushMessages } from '@/lib/services/expo-push';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Messages parked as `waiting_texts` (the business had no texts) are released here when texts are
 * available again. A release never sends by itself: it takes the texts, then moves the row to
 * `held`, and the existing sender (`sendHeldMessages`) does the quiet-hours check, opt-out check,
 * refund-on-failure and email fallback. One sending path only.
 */

export type ReleaseResult = {
  /** Moved to held (sent now, or in the morning if it is quiet hours). */
  released: number;
  /** Dropped: past its waiting_expires_at. */
  expired: number;
  /** Dropped: no longer needed (already paid, plan ended). */
  stale: number;
  /** Not enough texts, or a check failed. Still waiting. */
  stillWaiting: number;
  /** Money messages among `expired` (the trader is told about those). */
  expiredMoney: number;
};

const MAX_PER_CALL = 300;

function emptyResult(): ReleaseResult {
  return { released: 0, expired: 0, stale: 0, stillWaiting: 0, expiredMoney: 0 };
}

type WaitingRow = {
  id: string;
  tenant_id: string;
  customer_id: string;
  kind: string;
  segments: number | null;
  waiting_since: string | null;
  waiting_expires_at: string | null;
};

const MONEY_KIND_STRINGS = new Set(['visit_done', 'chaser', 'dd_invite', 'dd_failed']);

/** Does a "you owe us" message still make sense? 'unknown' means we could not check: keep waiting. */
async function stillOwed(
  admin: SupabaseClient,
  row: WaitingRow,
): Promise<'yes' | 'no' | 'unknown'> {
  if (row.kind !== 'chaser' && row.kind !== 'dd_failed') return 'yes';
  const { data, error } = await admin
    .from('customer_balances')
    .select('owed_amount')
    .eq('tenant_id', row.tenant_id)
    .eq('customer_id', row.customer_id)
    .maybeSingle();
  if (error) {
    console.error('[releaseWaiting] balance', error.message);
    return 'unknown';
  }
  const owed = Number((data as { owed_amount?: unknown } | null)?.owed_amount ?? 0);
  if (!Number.isFinite(owed)) return 'unknown';
  return owed > 0 ? 'yes' : 'no';
}

async function giveBack(
  admin: SupabaseClient,
  p: { tenantId: string; segments: number; from: string; month: string },
): Promise<void> {
  const { error } = await admin.rpc('refund_text_credits', {
    p_tenant_id: p.tenantId,
    p_segments: p.segments,
    p_from: p.from,
    p_month: p.month,
  });
  if (error) console.error('[releaseWaiting] refund', error.message);
}

/** One push per run. A failure here is logged and ignored: the list on the Texts page is the record. */
async function pushNotDelivered(admin: SupabaseClient, tenantId: string, count: number): Promise<void> {
  try {
    const worker = await getSoloWorkerForTenant(admin, tenantId);
    const token = worker?.expo_push_token?.trim() ?? '';
    if (!token) return;
    await sendExpoPushMessages([
      {
        to: token,
        title: 'WorkWise texts',
        body: `${count} ${count === 1 ? 'customer' : 'customers'} didn't get their message. Tap to see who.`,
        data: { type: 'texts_not_delivered' },
        sound: 'default',
      },
    ]);
  } catch (err) {
    console.error('[releaseWaiting] push', err instanceof Error ? err.message : String(err));
  }
}

/**
 * One business, oldest first. Never throws: on an error it stops and reports what it did.
 * Safe to run twice at once: every row is claimed with a conditional update.
 */
export async function releaseWaitingForTenant(
  admin: SupabaseClient,
  tenantId: string,
  now: Date = new Date(),
): Promise<ReleaseResult> {
  const result = emptyResult();
  try {
    const { data, error } = await admin
      .from('messages')
      .select('id, tenant_id, customer_id, kind, segments, waiting_since, waiting_expires_at')
      .eq('tenant_id', tenantId)
      .eq('status', 'waiting_texts')
      .order('waiting_since', { ascending: true })
      .limit(MAX_PER_CALL);
    if (error) {
      console.error('[releaseWaiting] list', error.message);
      return result;
    }
    const rows = (data ?? []) as WaitingRow[];
    if (rows.length === 0) return result;

    let entitled: Set<string>;
    try {
      entitled = new Set(await listRoundsTenantIds(admin));
    } catch {
      result.stillWaiting = rows.length;
      return result;
    }

    const allowance = await textAllowanceFor(admin, tenantId);
    const month = londonMonth(now);
    let outOfTexts = false;
    let heldAny = false;

    for (const row of rows) {
      const isMoney = MONEY_KIND_STRINGS.has(row.kind);
      const expiresAt = row.waiting_expires_at ? new Date(row.waiting_expires_at).getTime() : null;

      // 1. Past its time (or the plan has ended): drop it. Only the runner that wins counts it.
      const planEnded = !entitled.has(tenantId);
      if (planEnded || (expiresAt != null && expiresAt <= now.getTime())) {
        const { data: dropped, error: dropError } = await admin
          .from('messages')
          .update({ status: 'skipped', error: planEnded ? 'plan_ended' : 'waiting_expired' })
          .eq('id', row.id)
          .eq('status', 'waiting_texts')
          .select('id')
          .maybeSingle();
        if (dropError) {
          console.error('[releaseWaiting] expire', dropError.message);
          result.stillWaiting += 1;
        } else if (dropped) {
          if (planEnded) result.stale += 1;
          else {
            result.expired += 1;
            if (isMoney) result.expiredMoney += 1;
          }
        }
        continue;
      }

      if (outOfTexts) {
        result.stillWaiting += 1;
        continue;
      }

      // 2. Is it still worth sending? Unknown = keep waiting (never send on a guess).
      const owed = await stillOwed(admin, row);
      if (owed === 'unknown') {
        result.stillWaiting += 1;
        continue;
      }
      if (owed === 'no') {
        const { data: dropped } = await admin
          .from('messages')
          .update({ status: 'skipped', error: 'no_longer_needed' })
          .eq('id', row.id)
          .eq('status', 'waiting_texts')
          .select('id')
          .maybeSingle();
        if (dropped) result.stale += 1;
        continue;
      }

      // 3. Take the texts. None left (or a blip): stop, everything younger is stuck too.
      const segments = Math.max(row.segments ?? 1, 1);
      const { data: billedFrom, error: creditError } = await admin.rpc('claim_text_credits', {
        p_tenant_id: tenantId,
        p_segments: segments,
        p_allowance: allowance,
      });
      if (creditError) {
        console.error('[releaseWaiting] credits', creditError.message);
        outOfTexts = true;
        result.stillWaiting += 1;
        continue;
      }
      const from = typeof billedFrom === 'string' ? billedFrom : '';
      if (from !== 'allowance' && from !== 'pack') {
        outOfTexts = true;
        result.stillWaiting += 1;
        continue;
      }

      // 4. Claim the row: waiting -> held. Lost the race, or it changed: give the texts back.
      const holdUntil = isQuietHours(now) ? sendableFrom(now) : now;
      const { data: claimed, error: claimError } = await admin
        .from('messages')
        .update({
          status: 'held',
          hold_until: holdUntil.toISOString(),
          billed_from: from,
          billed_month: month,
        })
        .eq('id', row.id)
        .eq('status', 'waiting_texts')
        .select('id')
        .maybeSingle();
      if (claimError) {
        console.error('[releaseWaiting] claim', claimError.message);
        await giveBack(admin, { tenantId, segments, from, month });
        result.stillWaiting += 1;
        break;
      }
      if (!claimed) {
        await giveBack(admin, { tenantId, segments, from, month });
        continue;
      }
      result.released += 1;
      heldAny = true;
    }

    // 5. Send what was released (quiet-hours rows wait for morning).
    if (heldAny) {
      await sendHeldMessages(now, { tenantId });
    }

    // 6. Tell the owner once if pay-link style messages ran out of time: they must chase those by hand.
    if (result.expiredMoney > 0) {
      await pushNotDelivered(admin, tenantId, result.expiredMoney);
    }
  } catch (err) {
    console.error('[releaseWaiting]', err instanceof Error ? err.message : String(err));
  }
  return result;
}

/** Every business with waiting rows (7am cron). Never throws. */
export async function sweepWaitingMessages(
  now: Date = new Date(),
): Promise<{ tenants: number } & ReleaseResult> {
  const total = { tenants: 0, ...emptyResult() };
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('messages')
      .select('tenant_id')
      .eq('status', 'waiting_texts')
      .limit(2000);
    if (error) {
      console.error('[sweepWaiting] list', error.message);
      return total;
    }
    const ids = [...new Set((data ?? []).map((r) => (r as { tenant_id: string }).tenant_id))];
    for (const id of ids) {
      const r = await releaseWaitingForTenant(admin, id, now);
      total.tenants += 1;
      total.released += r.released;
      total.expired += r.expired;
      total.expiredMoney += r.expiredMoney;
      total.stale += r.stale;
      total.stillWaiting += r.stillWaiting;
    }
  } catch (err) {
    console.error('[sweepWaiting]', err instanceof Error ? err.message : String(err));
  }
  return total;
}
