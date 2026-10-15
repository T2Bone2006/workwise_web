import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { formatVisitDay } from '@/lib/payments/messages';
import { isValidYmd } from '@/lib/rounds/dates';
import { getSoloWorkerForTenant } from '@/lib/rounds/rounds-worker';
import { sendExpoPushMessages } from '@/lib/services/expo-push';

export type ReplyPush = {
  customerName: string;
  intent: 'said_no' | 'asked_move' | 'question';
  visitDate: string | null;
  requestedDate: string | null;
  body: string;
  threadId: string;
  jobId: string | null;
  /** A reply to a money text: says they've paid, or something about paying. */
  aboutPayment?: 'says_paid' | 'payment_question';
};

function dayLabel(ymd: string | null): string | null {
  if (!ymd || !isValidYmd(ymd)) return null;
  return formatVisitDay(ymd);
}

function pushBody(p: ReplyPush): string {
  if (p.aboutPayment === 'says_paid') return "Says they've paid — tap to check and mark paid";
  if (p.aboutPayment === 'payment_question') return `About a payment: ${p.body.slice(0, 60)}`;
  const visit = dayLabel(p.visitDate);
  const requested = dayLabel(p.requestedDate);
  if (p.intent === 'said_no') {
    return visit ? `Said no to ${visit} — tap to skip or keep` : 'Said no — tap to see';
  }
  if (p.intent === 'asked_move') {
    if (visit && requested) return `Asked to move ${visit} to ${requested}`;
    if (visit) return `Asked to move ${visit}`;
    if (requested) return `Asked to move to ${requested}`;
    return 'Asked to move';
  }
  return `Sent a message: ${p.body.slice(0, 60)}`;
}

/** title = customerName; body per intent. Never throws; no token = no push. */
export async function pushReplyToOwner(
  admin: SupabaseClient,
  tenantId: string,
  p: ReplyPush,
): Promise<void> {
  try {
    const worker = await getSoloWorkerForTenant(admin, tenantId);
    const token = worker?.expo_push_token?.trim() ?? '';
    if (!token) return;
    await sendExpoPushMessages([
      {
        to: token,
        title: p.customerName,
        body: pushBody(p),
        data: {
          type: 'rounds_message',
          threadId: p.threadId,
          ...(p.jobId ? { jobId: p.jobId } : {}),
        },
        sound: 'default',
      },
    ]);
  } catch (err) {
    console.error('[pushReplyToOwner]', err instanceof Error ? err.message : 'failed');
  }
}
