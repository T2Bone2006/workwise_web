import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { buildLowTextsEmail, type TextWarningLevel } from '@/lib/emails/low-texts';
import { ownerEmailFor, sendOwnerEmail } from '@/lib/emails/owner-notice';
import { summariseTexts } from '@/lib/messaging/credits';
import { isQuietHours, londonMonth } from '@/lib/messaging/london-time';
import { listRoundsTenantIds } from '@/lib/messaging/rounds-tenants';
import { textAllowanceFor } from '@/lib/messaging/text-allowance';
import { getSoloWorkerForTenant } from '@/lib/rounds/rounds-worker';
import { sendExpoPushMessages } from '@/lib/services/expo-push';
import { getAppUrl } from '@/lib/stripe/client';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Warn the owner once when texts fall to 20, and once at 0. The flags live on tenant_text_balance and
 * are claimed with a conditional update, so two runs at once cannot send two warnings. They are
 * cleared when the business is back above 20, so the next dip warns again.
 *
 * Leaf of send.ts: send.ts reaches this through a dynamic import, and nothing here imports send.ts.
 */

export const LOW_TEXTS_AT = 20;
export type { TextWarningLevel };

async function waitingCount(admin: SupabaseClient, tenantId: string): Promise<number> {
  const { count } = await admin
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('status', 'waiting_texts');
  return count ?? 0;
}

function pushFor(level: TextWarningLevel, left: number, waiting: number): { body: string; type: string } {
  if (level === 'out') {
    return {
      body:
        waiting > 0
          ? `You're out of texts. ${waiting} message${waiting === 1 ? ' is' : 's are'} waiting. Tap to fix.`
          : "You're out of texts. Tap to fix.",
      type: 'texts_out',
    };
  }
  return { body: `You're down to ${left} texts. Tap to top up.`, type: 'texts_low' };
}

/** Decide and send. Never throws. Returns what it did. */
export async function checkTextWarnings(
  admin: SupabaseClient,
  tenantId: string,
  now: Date = new Date(),
): Promise<{ sent: TextWarningLevel | null }> {
  try {
    const { data, error } = await admin
      .from('tenant_text_balance')
      .select('month, month_used, pack_balance, low_warned_at, out_warned_at')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (error) {
      console.error('[checkTextWarnings] balance', error.message);
      return { sent: null };
    }
    const row = data as {
      month: string;
      month_used: number;
      pack_balance: number;
      low_warned_at: string | null;
      out_warned_at: string | null;
    } | null;
    const summary = summariseTexts(row, londonMonth(now), await textAllowanceFor(admin, tenantId));
    const left = summary.totalLeft;

    // Back in credit: re-arm both warnings.
    if (left > LOW_TEXTS_AT) {
      if (row && (row.low_warned_at || row.out_warned_at)) {
        await admin
          .from('tenant_text_balance')
          .update({ low_warned_at: null, out_warned_at: null })
          .eq('tenant_id', tenantId);
      }
      return { sent: null };
    }

    // No row yet means fresh: nothing to flag until a text has been used.
    if (!row) return { sent: null };
    // At night nothing is claimed; the 7am sweep sends it.
    if (isQuietHours(now)) return { sent: null };

    const level: TextWarningLevel = left === 0 ? 'out' : 'low';
    const claimed =
      level === 'out'
        ? await admin
            .from('tenant_text_balance')
            .update({ out_warned_at: now.toISOString(), low_warned_at: row.low_warned_at ?? now.toISOString() })
            .eq('tenant_id', tenantId)
            .is('out_warned_at', null)
            .select('tenant_id')
            .maybeSingle()
        : await admin
            .from('tenant_text_balance')
            .update({ low_warned_at: now.toISOString() })
            .eq('tenant_id', tenantId)
            .is('low_warned_at', null)
            .select('tenant_id')
            .maybeSingle();
    if (claimed.error) {
      console.error('[checkTextWarnings] claim', claimed.error.message);
      return { sent: null };
    }
    if (!claimed.data) return { sent: null }; // already warned for this dip

    const waiting = await waitingCount(admin, tenantId);
    let delivered = false;

    try {
      const worker = await getSoloWorkerForTenant(admin, tenantId);
      const token = worker?.expo_push_token?.trim() ?? '';
      if (token) {
        const push = pushFor(level, left, waiting);
        await sendExpoPushMessages([
          { to: token, title: 'WorkWise texts', body: push.body, data: { type: push.type }, sound: 'default' },
        ]);
        delivered = true;
      }
    } catch (err) {
      console.error('[checkTextWarnings] push', err instanceof Error ? err.message : String(err));
    }

    try {
      const to = await ownerEmailFor(admin, tenantId);
      if (to) {
        const result = await sendOwnerEmail({
          to,
          idempotencyKey: `texts-${level}-${tenantId}-${now.toISOString()}`,
          content: buildLowTextsEmail({
            level,
            textsLeft: left,
            waiting,
            packsUrl: `${getAppUrl()}/messages`,
          }),
        });
        if (result.ok) delivered = true;
      }
    } catch (err) {
      console.error('[checkTextWarnings] email', err instanceof Error ? err.message : String(err));
    }

    if (!delivered) {
      // Neither reached them: put the flag back so the next check tries again.
      await admin
        .from('tenant_text_balance')
        .update(level === 'out' ? { out_warned_at: null } : { low_warned_at: null })
        .eq('tenant_id', tenantId);
      return { sent: null };
    }
    return { sent: level };
  } catch (err) {
    console.error('[checkTextWarnings]', err instanceof Error ? err.message : String(err));
    return { sent: null };
  }
}

/** Cron backstop: every Rounds business. Never throws. */
export async function sweepTextWarnings(now: Date = new Date()): Promise<{ checked: number; sent: number }> {
  const out = { checked: 0, sent: 0 };
  try {
    const admin = createAdminClient();
    const ids = await listRoundsTenantIds(admin);
    for (const id of ids) {
      const r = await checkTextWarnings(admin, id, now);
      out.checked += 1;
      if (r.sent) out.sent += 1;
    }
  } catch (err) {
    console.error('[sweepTextWarnings]', err instanceof Error ? err.message : String(err));
  }
  return out;
}
