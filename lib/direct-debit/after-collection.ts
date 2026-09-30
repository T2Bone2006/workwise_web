import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { collectForCustomer } from '@/lib/direct-debit/collect';
import { composeDirectDebitFailed } from '@/lib/direct-debit/messages';
import { customerEmailFrom, emailDocument } from '@/lib/emails/visit-done';
import { GoCardlessError } from '@/lib/gocardless/client';
import { clientForTenant } from '@/lib/gocardless/connection';
import { getTenantMessagingContext } from '@/lib/messaging/brand';
import { sendCustomerMessage } from '@/lib/messaging/send';
import { formatGbp, fromPence, toPence } from '@/lib/money/pence';
import { ensurePayLinkToken } from '@/lib/payments/money-core';
import { payLinkUrl } from '@/lib/payments/tokens';
import { sendOrHoldOwnerPush } from '@/lib/push/owner-push';

type Row = Record<string, unknown>;

const PUSH_WINDOW_MS = 60 * 60 * 1000;

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Plain-English reason for the trader. */
export function failureReasonText(code: string | null): string {
  switch (code) {
    case 'insufficient_funds':
      return 'not enough money in their account';
    case 'refer_to_payer':
      return 'their bank refused it';
    case 'bank_account_closed':
      return 'their account is closed';
    case 'mandate_cancelled':
    case 'authorisation_disputed':
      return 'they cancelled the Direct Debit';
    default:
      return "their bank didn't pay it";
  }
}

async function pushTrader(
  admin: SupabaseClient,
  c: { tenantId: string; customerId: string; name: string; amount: number; code: string | null },
): Promise<void> {
  await sendOrHoldOwnerPush(admin, c.tenantId, {
    kind: 'dd_failed',
    title: 'Direct Debit failed',
    body: `${c.name}: ${formatGbp(c.amount)} wasn't collected — ${failureReasonText(c.code)}. Collect again or leave it?`,
    data: { type: 'dd_failed', amount: c.amount, customerId: c.customerId, customerName: c.name },
  });
}

async function messageCustomer(
  admin: SupabaseClient,
  c: { tenantId: string; customerId: string; collectionId: string; amount: number; stillActive: boolean },
): Promise<void> {
  const { data } = await admin
    .from('customers')
    .select('name, email')
    .eq('id', c.customerId)
    .eq('tenant_id', c.tenantId)
    .maybeSingle();
  const customer = data as Row | null;
  const ctx = await getTenantMessagingContext(admin, c.tenantId);
  const token = await ensurePayLinkToken(admin, { tenantId: c.tenantId, customerId: c.customerId });
  if (!customer || !ctx || !token) {
    console.error('[dd failed] no message: missing customer, business or pay link', c.collectionId);
    return;
  }
  const url = payLinkUrl(token);
  const customerEmail = str(customer.email);
  const message = composeDirectDebitFailed({
    businessName: ctx.businessName,
    customerName: str(customer.name) ?? '',
    amount: c.amount,
    payUrl: url,
    contactPhone: ctx.contactPhone,
    stillActive: c.stillActive,
  });
  const brand = { businessName: ctx.businessName, logoUrl: ctx.logoUrl };
  const signOff = `Thanks,\n${ctx.businessName}`;
  const payLabel = `Pay ${formatGbp(c.amount, { always2dp: true })}`;

  const outcome = await sendCustomerMessage({
    tenantId: c.tenantId,
    customerId: c.customerId,
    kind: 'dd_failed',
    dedupeKey: `dd_failed:${c.collectionId}`,
    text: () => message.sms,
    email: customerEmail
      ? async () => {
          const html = emailDocument({
            subject: message.subject,
            brand,
            greeting: message.greeting,
            paragraphs: message.emailParagraphs,
            payUrl: url,
            payLabel,
            afterButton: message.afterButton,
            bankLine: null,
            signOff,
          });
          const text = [
            message.greeting,
            '',
            ...message.emailParagraphs,
            url,
            '',
            ...message.afterButton,
            '',
            signOff,
          ].join('\n');
          try {
            const { resend } = await import('@/lib/resend');
            const { error } = await resend.emails.send({
              from: customerEmailFrom(ctx.businessName),
              to: customerEmail,
              subject: message.subject,
              html,
              text,
              ...(ctx.replyToEmail ? { replyTo: ctx.replyToEmail } : {}),
            });
            if (error) {
              console.error('[dd failed] email', error.message);
              return { sent: false, error: error.message };
            }
            return { sent: true };
          } catch (err) {
            const text = err instanceof Error ? err.message : String(err);
            console.error('[dd failed] email', text);
            return { sent: false, error: text };
          }
        }
      : null,
  });
  if (outcome.outcome === 'failed') console.error('[dd failed] message', outcome.error);
}

/** Push the trader and message the customer. Never throws. Safe to call twice (message dedupe key `dd_failed:<collectionId>`; push only when the collection's finished_at is within the last hour). */
export async function afterCollectionFailed(admin: SupabaseClient, collectionId: string): Promise<void> {
  try {
    const { data, error } = await admin
      .from('direct_debit_collections')
      .select('id, tenant_id, customer_id, direct_debit_id, amount, status, failure_code, finished_at')
      .eq('id', collectionId)
      .maybeSingle();
    const collection = data as Row | null;
    if (error || !collection || collection.status !== 'failed') return;
    const tenantId = String(collection.tenant_id);
    const customerId = String(collection.customer_id);
    const amount = num(collection.amount);

    const [{ data: customerData }, { data: ddData }] = await Promise.all([
      admin.from('customers').select('name').eq('id', customerId).eq('tenant_id', tenantId).maybeSingle(),
      admin
        .from('customer_direct_debits')
        .select('status')
        .eq('id', String(collection.direct_debit_id))
        .eq('tenant_id', tenantId)
        .maybeSingle(),
    ]);
    const name = str((customerData as Row | null)?.name) ?? 'A customer';
    const stillActive = ['pending', 'active'].includes(String((ddData as Row | null)?.status));

    const finishedAt = Date.parse(String(collection.finished_at));
    if (Number.isFinite(finishedAt) && Date.now() - finishedAt <= PUSH_WINDOW_MS) {
      try {
        await pushTrader(admin, { tenantId, customerId, name, amount, code: str(collection.failure_code) });
      } catch (err) {
        console.error('[dd failed] push', err instanceof Error ? err.message : 'error');
      }
    }
    try {
      await messageCustomer(admin, { tenantId, customerId, collectionId, amount, stillActive });
    } catch (err) {
      console.error('[dd failed] message', err instanceof Error ? err.message : 'error');
    }
  } catch (err) {
    console.error('[dd failed]', collectionId, err instanceof Error ? err.message : 'error');
  }
}

export type ResolveResult = { ok: true; newCollectionId: string | null } | { ok: false; error: string };

export async function resolveFailedCollection(
  admin: SupabaseClient,
  p: { tenantId: string; userId: string; collectionId: string; action: 'collect_again' | 'leave' },
): Promise<ResolveResult> {
  const { data: found, error: readError } = await admin
    .from('direct_debit_collections')
    .select('id, customer_id, amount, status, resolution')
    .eq('id', p.collectionId)
    .eq('tenant_id', p.tenantId)
    .maybeSingle();
  if (readError) return { ok: false, error: "Couldn't check that. Try again in a minute." };
  const collection = found as Row | null;
  if (!collection || collection.status !== 'failed' || collection.resolution != null) {
    return { ok: false, error: 'This has already been sorted.' };
  }

  // Resolve first, so two taps (or two people) can't both act.
  const { data: claimed, error: claimError } = await admin
    .from('direct_debit_collections')
    .update({
      resolution: p.action === 'leave' ? 'left' : 'collect_again',
      resolved_at: new Date().toISOString(),
      resolved_by_user_id: p.userId,
    })
    .eq('id', p.collectionId)
    .eq('tenant_id', p.tenantId)
    .eq('status', 'failed')
    .is('resolution', null)
    .select('id');
  if (claimError) return { ok: false, error: "Couldn't save that. Try again in a minute." };
  if (!Array.isArray(claimed) || claimed.length === 0) {
    return { ok: false, error: 'This has already been sorted.' };
  }

  if (p.action === 'leave') return { ok: true, newCollectionId: null };

  const revert = async () => {
    const { error } = await admin
      .from('direct_debit_collections')
      .update({ resolution: null, resolved_at: null, resolved_by_user_id: null })
      .eq('id', p.collectionId)
      .eq('tenant_id', p.tenantId);
    if (error) console.error('[dd resolve] could not undo', error.code);
  };

  let outcome;
  try {
    outcome = await collectForCustomer(admin, {
      tenantId: p.tenantId,
      customerId: String(collection.customer_id),
      createdBy: 'trader',
      userId: p.userId,
      amount: num(collection.amount),
    });
  } catch (err) {
    console.error('[dd resolve] collect', err instanceof Error ? err.message : 'error');
    await revert();
    return { ok: false, error: "Couldn't start the collection. Try again in a minute." };
  }

  if (outcome.kind === 'created') return { ok: true, newCollectionId: outcome.collectionId };
  if (outcome.kind === 'skipped' && outcome.reason === 'nothing_to_collect') {
    return { ok: true, newCollectionId: null };
  }
  await revert();
  if (outcome.kind === 'skipped' && outcome.reason === 'no_direct_debit') {
    return { ok: false, error: "Their Direct Debit isn't active any more — send them the pay link instead." };
  }
  return { ok: false, error: "Couldn't start the collection. Try again in a minute." };
}

export async function cancelDirectDebit(
  admin: SupabaseClient,
  p: { tenantId: string; userId: string; customerId: string },
): Promise<{ ok: true; stillCollecting: number } | { ok: false; error: string }> {
  const { data, error } = await admin
    .from('customer_direct_debits')
    .select('id, source, status, gocardless_mandate_id')
    .eq('tenant_id', p.tenantId)
    .eq('customer_id', p.customerId)
    .in('status', ['pending', 'active'])
    .maybeSingle();
  if (error) return { ok: false, error: "Couldn't check that. Try again in a minute." };
  const dd = data as Row | null;
  if (!dd) return { ok: false, error: 'No active Direct Debit.' };
  const mandateId = str(dd.gocardless_mandate_id);

  // Only this one mandate is ever cancelled. Whatever GoCardless answers, WorkWise stops collecting.
  if (mandateId) {
    try {
      const unlocked = await clientForTenant(admin, p.tenantId);
      if (unlocked) {
        await unlocked.client.action(`/mandates/${encodeURIComponent(mandateId)}/actions/cancel`);
      } else {
        console.error('[dd cancel] no GoCardless connection; cancelled in WorkWise only');
      }
    } catch (err) {
      if (err instanceof GoCardlessError) {
        console.error('[dd cancel] GoCardless', { status: err.status, type: err.type, reasons: err.reasons });
      } else {
        console.error('[dd cancel] GoCardless', err instanceof Error ? err.message : 'error');
      }
    }
  }

  const { error: updateError } = await admin
    .from('customer_direct_debits')
    .update({ status: 'cancelled', cancelled_by: 'trader', cancelled_at: new Date().toISOString() })
    .eq('id', String(dd.id))
    .eq('tenant_id', p.tenantId)
    .in('status', ['pending', 'active']);
  if (updateError) return { ok: false, error: "Couldn't cancel it. Try again in a minute." };

  if (dd.source === 'imported' && mandateId) {
    const { error: linkError } = await admin
      .from('gocardless_mandate_links')
      .update({
        decision: 'ignored',
        decided_at: new Date().toISOString(),
        decided_by_user_id: p.userId,
      })
      .eq('tenant_id', p.tenantId)
      .eq('gocardless_mandate_id', mandateId);
    if (linkError) console.error('[dd cancel] mandate link', linkError.code);
  }

  const { data: processing } = await admin
    .from('direct_debit_collections')
    .select('amount')
    .eq('tenant_id', p.tenantId)
    .eq('customer_id', p.customerId)
    .eq('status', 'processing');
  const stillCollecting = fromPence(
    ((processing ?? []) as Row[]).reduce((sum, r) => sum + toPence(num(r.amount)), 0),
  );
  return { ok: true, stillCollecting };
}
