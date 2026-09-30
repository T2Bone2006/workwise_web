import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { formatGbp, fromPence, toPence } from '@/lib/money/pence';
import { isQuietHours, sendableFrom } from '@/lib/messaging/london-time';
import { getSoloWorkerForTenant } from '@/lib/rounds/rounds-worker';
import {
  sendExpoPushMessages,
  type ExpoPushMessage,
} from '@/lib/services/expo-push';

/**
 * dd_attention: GoCardless warnings (another app collecting, verification
 * needed, over £1,000, disconnected) — one push each, never grouped.
 */
export type OwnerPushKind =
  | 'card_payment'
  | 'dd_payment'
  | 'dd_failed'
  | 'dd_cancelled'
  | 'dd_active'
  | 'dd_attention';

export type OwnerPush = {
  kind: OwnerPushKind;
  title: string; // ≤ 80
  body: string; // ≤ 200
  data: {
    type: OwnerPushKind;
    amount?: number;
    customerId?: string;
    customerName?: string;
  };
};

/** Pushes one business gets from a single morning run before the rest collapse into "and N more". */
const MAX_PER_BUSINESS = 5;
/** Expo accepts up to 100 messages per request. */
const EXPO_BATCH = 100;

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

function sumAmounts(amounts: number[]): number {
  return fromPence(
    amounts.reduce((sum, a) => sum + (Number.isFinite(a) ? toPence(a) : 0), 0),
  );
}

export function groupedCardPush(amounts: number[]): { title: string; body: string } {
  const n = amounts.length;
  return {
    title: 'Card payments',
    body: `${n} card payment${n === 1 ? '' : 's'} came in overnight (${formatGbp(sumAmounts(amounts))})`,
  };
}

export function groupedDirectDebitPush(
  amounts: number[],
  customerName?: string,
): { title: string; body: string } {
  if (amounts.length === 1) {
    return {
      title: 'Direct Debit received',
      body: `${formatGbp(amounts[0])} from ${customerName?.trim() || 'a customer'}`,
    };
  }
  return {
    title: 'Direct Debits',
    body: `${amounts.length} Direct Debits came in (${formatGbp(sumAmounts(amounts))})`,
  };
}

async function pushTokenFor(
  admin: SupabaseClient,
  tenantId: string,
): Promise<string | null> {
  const worker = await getSoloWorkerForTenant(admin, tenantId);
  const token = worker?.expo_push_token?.trim() ?? '';
  return token === '' ? null : token;
}

function toMessage(token: string, push: Pick<OwnerPush, 'title' | 'body' | 'data'>): ExpoPushMessage {
  return {
    to: token,
    title: clip(push.title, 80),
    body: clip(push.body, 200),
    data: push.data,
    sound: 'default',
  };
}

/**
 * Quiet hours (21:00–07:00 London) → insert owner_pushes (send_after =
 * sendableFrom(now)); otherwise send now. Never throws. No push token →
 * 'no_token' and nothing stored.
 */
export async function sendOrHoldOwnerPush(
  admin: SupabaseClient,
  tenantId: string,
  push: OwnerPush,
  now: Date = new Date(),
): Promise<'sent' | 'held' | 'no_token' | 'failed'> {
  try {
    const token = await pushTokenFor(admin, tenantId);
    if (!token) return 'no_token';

    if (isQuietHours(now)) {
      const { error } = await admin.from('owner_pushes').insert({
        tenant_id: tenantId,
        kind: push.kind,
        title: clip(push.title, 80),
        body: clip(push.body, 200),
        data: push.data,
        send_after: sendableFrom(now).toISOString(),
      });
      if (error) {
        console.error('[owner-push] hold failed', error);
        return 'failed';
      }
      return 'held';
    }

    await sendExpoPushMessages([toMessage(token, push)]);
    return 'sent';
  } catch (err) {
    console.error('[owner-push] send failed', err);
    return 'failed';
  }
}

type HeldRow = {
  tenant_id: string;
  kind: OwnerPushKind;
  title: string;
  body: string;
  data: OwnerPush['data'];
  created_at: string;
};

function asHeldRow(raw: Record<string, unknown>): HeldRow | null {
  const tenantId = typeof raw.tenant_id === 'string' ? raw.tenant_id : null;
  const kind = typeof raw.kind === 'string' ? (raw.kind as OwnerPushKind) : null;
  const title = typeof raw.title === 'string' ? raw.title : null;
  const body = typeof raw.body === 'string' ? raw.body : null;
  if (!tenantId || !kind || !title || !body) return null;
  const data =
    raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data)
      ? (raw.data as OwnerPush['data'])
      : { type: kind };
  return {
    tenant_id: tenantId,
    kind,
    title,
    body,
    data,
    created_at: typeof raw.created_at === 'string' ? raw.created_at : '',
  };
}

function amountOf(row: HeldRow): number {
  const amount = row.data.amount;
  return typeof amount === 'number' && Number.isFinite(amount) ? amount : 0;
}

/** One business's held rows → the pushes to send (grouped, capped). */
function pushesForBusiness(rows: HeldRow[]): Pick<OwnerPush, 'title' | 'body' | 'data'>[] {
  const sorted = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const cards = sorted.filter((r) => r.kind === 'card_payment');
  const dds = sorted.filter((r) => r.kind === 'dd_payment');

  const out: Pick<OwnerPush, 'title' | 'body' | 'data'>[] = [];
  let cardsDone = false;
  let ddsDone = false;
  for (const row of sorted) {
    if (row.kind === 'card_payment') {
      if (cardsDone) continue;
      cardsDone = true;
      if (cards.length === 1) {
        out.push(row);
      } else {
        const amounts = cards.map(amountOf);
        out.push({
          ...groupedCardPush(amounts),
          data: { type: 'card_payment', amount: sumAmounts(amounts) },
        });
      }
    } else if (row.kind === 'dd_payment') {
      if (ddsDone) continue;
      ddsDone = true;
      if (dds.length === 1) {
        out.push(row);
      } else {
        const amounts = dds.map(amountOf);
        out.push({
          ...groupedDirectDebitPush(amounts),
          data: { type: 'dd_payment', amount: sumAmounts(amounts) },
        });
      }
    } else {
      out.push(row);
    }
  }

  if (out.length <= MAX_PER_BUSINESS) return out;
  const more = out.length - MAX_PER_BUSINESS;
  return [
    ...out.slice(0, MAX_PER_BUSINESS),
    {
      title: 'More updates',
      body: `And ${more} more — open WorkWise to see them.`,
      data: { type: out[MAX_PER_BUSINESS].data.type },
    },
  ];
}

/**
 * Claim (sent_at = now where sent_at is null) and send every held push with
 * send_after ≤ now. Per business: several 'card_payment' → one; several
 * 'dd_payment' → one; others one each (max 5 per business, then one
 * 'and N more' push). A failed send keeps sent_at — a push isn't worth
 * sending twice. Never throws.
 */
export async function sendDueOwnerPushes(
  admin: SupabaseClient,
  now: Date = new Date(),
): Promise<{ sent: number }> {
  try {
    const nowIso = now.toISOString();
    // One UPDATE … WHERE sent_at IS NULL: a second run at the same time claims nothing.
    const { data, error } = await admin
      .from('owner_pushes')
      .update({ sent_at: nowIso })
      .is('sent_at', null)
      .lte('send_after', nowIso)
      .select('tenant_id, kind, title, body, data, created_at');

    if (error) {
      console.error('[owner-push] claim failed', error);
      return { sent: 0 };
    }

    const byTenant = new Map<string, HeldRow[]>();
    for (const raw of (data ?? []) as Record<string, unknown>[]) {
      const row = asHeldRow(raw);
      if (!row) continue;
      const list = byTenant.get(row.tenant_id) ?? [];
      list.push(row);
      byTenant.set(row.tenant_id, list);
    }

    const messages: ExpoPushMessage[] = [];
    for (const [tenantId, rows] of byTenant) {
      try {
        const token = await pushTokenFor(admin, tenantId);
        if (!token) continue;
        for (const push of pushesForBusiness(rows)) {
          messages.push(toMessage(token, push));
        }
      } catch (err) {
        console.error('[owner-push] business failed', tenantId, err);
      }
    }

    let sent = 0;
    for (let i = 0; i < messages.length; i += EXPO_BATCH) {
      const batch = messages.slice(i, i + EXPO_BATCH);
      try {
        await sendExpoPushMessages(batch);
        sent += batch.length;
      } catch (err) {
        console.error('[owner-push] batch failed', err);
      }
    }
    return { sent };
  } catch (err) {
    console.error('[owner-push] sendDueOwnerPushes failed', err);
    return { sent: 0 };
  }
}
