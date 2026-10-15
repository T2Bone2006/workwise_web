import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { loadChaserMoney } from '@/lib/direct-debit/state';
import { getTenantMessagingContext } from '@/lib/messaging/brand';
import { asCustomerFlag } from '@/lib/messaging/customer-flag';
import {
  planChasers,
  type ChaserCandidate,
} from '@/lib/messaging/chasers';
import { sendCustomerMessage } from '@/lib/messaging/send';
import { chaserSms } from '@/lib/messaging/templates';
import {
  getPaymentSettings,
  hasBankDetails,
} from '@/lib/data/payments/settings';
import {
  buildVisitDoneEmail,
  customerEmailFrom,
} from '@/lib/emails/visit-done';
import { composeChaserMessage } from '@/lib/payments/messages';
import { ensurePayLinkToken } from '@/lib/payments/money-core';
import { payLinkUrl } from '@/lib/payments/tokens';
import { todayInLondon } from '@/lib/rounds/dates';

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

type EmptyCounts = {
  planned: number;
  sent: number;
  held: number;
  duplicate: number;
  skipped: number;
  failed: number;
};

function emptyCounts(): EmptyCounts {
  return {
    planned: 0,
    sent: 0,
    held: 0,
    duplicate: 0,
    skipped: 0,
    failed: 0,
  };
}

/** Plans and sends today's chasers for one business. Never throws. */
export async function runChasersForTenant(
  admin: SupabaseClient,
  tenantId: string,
  now: Date = new Date(),
): Promise<EmptyCounts> {
  const counts = emptyCounts();
  try {
    const ctx = await getTenantMessagingContext(admin, tenantId);
    if (!ctx) return counts;

    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000).toISOString();

    const [{ data: balances, error: balanceError }, settings] =
      await Promise.all([
        admin
          .from('customer_balances')
          .select('customer_id, owed_amount, unpaid_visit_count, oldest_unpaid_date')
          .eq('tenant_id', tenantId)
          .gt('owed_amount', 0),
        getPaymentSettings(admin, tenantId),
      ]);

    if (balanceError) {
      console.error('[runChasersForTenant] balances', balanceError.message);
      return counts;
    }

    const balanceRows = (balances ?? []) as unknown as Record<string, unknown>[];
    const customerIds = balanceRows
      .map((row) => asString(row.customer_id))
      .filter((id): id is string => id != null);

    if (customerIds.length === 0) return counts;

    const [
      { data: customers, error: customerError },
      { data: chaserMsgs, error: chaserError },
      { data: waitingThreads, error: waitingError },
    ] =
      await Promise.all([
        admin
          .from('customers')
          .select(
            'id, name, email, phone_e164, preferred_channel, payment_terms, payment_chasers, is_active, bank_reference_hint',
          )
          .eq('tenant_id', tenantId)
          .in('id', customerIds),
        admin
          .from('messages')
          .select('customer_id, created_at')
          .eq('tenant_id', tenantId)
          .eq('kind', 'chaser')
          .in('customer_id', customerIds)
          .gte('created_at', thirtyDaysAgo)
          .order('created_at', { ascending: false }),
        admin
          .from('message_threads')
          .select('customer_id')
          .eq('tenant_id', tenantId)
          .eq('status', 'needs_attention')
          .in('customer_id', customerIds),
      ]);

    if (customerError) {
      console.error('[runChasersForTenant] customers', customerError.message);
      return counts;
    }
    if (chaserError) {
      console.error('[runChasersForTenant] chasers', chaserError.message);
      return counts;
    }
    if (waitingError) {
      // Fail safe: if we can't tell who replied, chase nobody tonight.
      console.error('[runChasersForTenant] threads', waitingError.message);
      return counts;
    }
    const awaitingReview = new Set(
      ((waitingThreads ?? []) as { customer_id?: unknown }[])
        .map((row) => asString(row.customer_id))
        .filter((id): id is string => id != null),
    );

    const customersById = new Map<string, Record<string, unknown>>();
    for (const row of customers ?? []) {
      const record = row as unknown as Record<string, unknown>;
      const id = asString(record.id);
      if (id) customersById.set(id, record);
    }

    // No unpaid visits but still owed = only other amounts owed (D12).
    const visitsOwedByCustomer = new Map<string, boolean>();
    for (const row of balanceRows) {
      const customerId = asString(row.customer_id);
      if (customerId) {
        visitsOwedByCustomer.set(customerId, (asFiniteNumber(row.unpaid_visit_count) ?? 0) > 0);
      }
    }

    const lastChaserByCustomer = new Map<string, string>();
    for (const row of chaserMsgs ?? []) {
      const record = row as unknown as Record<string, unknown>;
      const customerId = asString(record.customer_id);
      const createdAt = asString(record.created_at);
      if (!customerId || !createdAt) continue;
      if (!lastChaserByCustomer.has(customerId)) {
        lastChaserByCustomer.set(customerId, createdAt);
      }
    }

    // Step 15: chase what Direct Debit isn't already covering. If we can't tell, chase nobody tonight.
    const owedByCustomer = new Map<string, number>();
    for (const row of balanceRows) {
      const id = asString(row.customer_id);
      if (id) owedByCustomer.set(id, asFiniteNumber(row.owed_amount) ?? 0);
    }
    const money = await loadChaserMoney(admin, tenantId, owedByCustomer, now);
    if (!money) {
      console.error('[runChasersForTenant] direct debit facts unavailable');
      return counts;
    }

    const candidates: ChaserCandidate[] = [];
    for (const row of balanceRows) {
      const customerId = asString(row.customer_id);
      if (!customerId) continue;
      const customer = customersById.get(customerId);
      if (!customer) continue;
      const oldestUnpaidDate = asString(row.oldest_unpaid_date)?.slice(0, 10);
      if (!oldestUnpaidDate) continue;

      const facts = money.get(customerId);
      candidates.push({
        customerId,
        owed: facts?.chaseAmount ?? asFiniteNumber(row.owed_amount) ?? 0,
        directDebitWorking: facts?.directDebitWorking ?? false,
        oldestUnpaidDate,
        paymentTerms: asString(customer.payment_terms),
        paymentChasers: asCustomerFlag(customer.payment_chasers),
        isActive: asBool(customer.is_active, true),
        preferredChannel: asString(customer.preferred_channel),
        lastChaserAt: lastChaserByCustomer.get(customerId) ?? null,
        awaitingReview: awaitingReview.has(customerId),
      });
    }

    const today = todayInLondon(now);
    const plans = planChasers(candidates, ctx.settings, {
      today,
      invoiceDueDays: settings.invoiceDueDays,
      now,
    });
    counts.planned = plans.length;

    const bank = hasBankDetails(settings)
      ? {
          accountName: settings.bankAccountName!,
          sortCode: settings.bankSortCode!,
          accountNumber: settings.bankAccountNumber!,
        }
      : null;

    for (const plan of plans) {
      try {
        const customer = customersById.get(plan.customerId);
        if (!customer) {
          counts.failed += 1;
          continue;
        }

        const token = await ensurePayLinkToken(admin, {
          tenantId,
          customerId: plan.customerId,
        });
        if (!token) {
          counts.failed += 1;
          continue;
        }
        const payUrl = payLinkUrl(token);
        const customerName = asString(customer.name) ?? 'there';
        const customerEmail = asString(customer.email);
        const reference = asString(customer.bank_reference_hint);
        const forVisits = visitsOwedByCustomer.get(plan.customerId) ?? true;
        const msg = composeChaserMessage({
          businessName: ctx.businessName,
          customerName,
          owed: plan.owed,
          stage: plan.stage,
          payUrl,
          bank,
          reference,
          forVisits,
        });
        const brand = {
          businessName: ctx.businessName,
          logoUrl: ctx.logoUrl,
        };
        const replyTo = ctx.replyToEmail;

        const door = await sendCustomerMessage({
          tenantId,
          customerId: plan.customerId,
          kind: 'chaser',
          dedupeKey: plan.dedupeKey,
          text: () =>
            chaserSms({
              brand: {
                businessName: ctx.businessName,
                contactPhone: ctx.contactPhone,
              },
              owed: plan.owed,
              payUrl,
              stage: plan.stage,
              forVisits,
            }),
          email: customerEmail
            ? async () => {
                const built = buildVisitDoneEmail(msg, brand);
                try {
                  const { resend } = await import('@/lib/resend');
                  const { error } = await resend.emails.send({
                    from: customerEmailFrom(ctx.businessName),
                    to: customerEmail,
                    subject: built.subject,
                    html: built.html,
                    text: built.text,
                    ...(replyTo ? { replyTo } : {}),
                  });
                  if (error) {
                    console.error(
                      '[runChasersForTenant] resend',
                      error.message,
                    );
                    return { sent: false, error: error.message };
                  }
                  return { sent: true };
                } catch (err) {
                  const message =
                    err instanceof Error ? err.message : String(err);
                  console.error('[runChasersForTenant] resend', message);
                  return { sent: false, error: message };
                }
              }
            : null,
          jobIds: [],
          now,
        });

        switch (door.outcome) {
          case 'text_sent':
          case 'email_sent':
            counts.sent += 1;
            break;
          case 'text_held':
            counts.held += 1;
            break;
          case 'duplicate':
            counts.duplicate += 1;
            break;
          case 'skipped':
            counts.skipped += 1;
            break;
          case 'failed':
            counts.failed += 1;
            break;
        }
      } catch (err) {
        counts.failed += 1;
        console.error(
          '[runChasersForTenant] customer',
          plan.customerId,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    return counts;
  } catch (err) {
    console.error(
      '[runChasersForTenant]',
      err instanceof Error ? err.message : String(err),
    );
    return counts;
  }
}
