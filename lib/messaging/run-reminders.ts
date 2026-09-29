import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { getTenantMessagingContext } from '@/lib/messaging/brand';
import {
  planReminders,
  reminderTargetDate,
  type ReminderCustomer,
  type ReminderVisit,
} from '@/lib/messaging/reminders';
import { sendCustomerMessage } from '@/lib/messaging/send';
import { reminderSms } from '@/lib/messaging/templates';
import { formatVisitDay } from '@/lib/payments/messages';
import { todayInLondon } from '@/lib/rounds/dates';

type ReminderCounts = {
  targetDate: string;
  planned: number;
  sent: number;
  held: number;
  duplicate: number;
  skippedNoTexts: number;
  skipped: number;
  failed: number;
};

function emptyCounts(targetDate = ''): ReminderCounts {
  return {
    targetDate,
    planned: 0,
    sent: 0,
    held: 0,
    duplicate: 0,
    skippedNoTexts: 0,
    skipped: 0,
    failed: 0,
  };
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asNullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function agreementReminderEnabled(raw: unknown): boolean {
  if (raw == null) return true;
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (!row || typeof row !== 'object' || Array.isArray(row)) return true;
  const enabled = (row as { reminder_enabled?: unknown }).reminder_enabled;
  return enabled !== false;
}

function mapVisit(row: Record<string, unknown>): ReminderVisit | null {
  const id = asString(row.id);
  if (!id) return null;
  return {
    id,
    customer_id: asString(row.customer_id),
    service_agreement_id: asString(row.service_agreement_id),
    status: asString(row.status) ?? '',
    scheduled_date: asString(row.scheduled_date)?.slice(0, 10) ?? '',
    scheduled_time: asString(row.scheduled_time),
    address: asString(row.address) ?? '',
    postcode: asString(row.postcode) ?? '',
    route_position: asNullableNumber(row.route_position),
    custom_fields: row.custom_fields,
    job_description: asString(row.job_description),
    agreement_reminder_enabled: agreementReminderEnabled(
      row.service_agreements,
    ),
  };
}

function mapCustomer(row: Record<string, unknown>): ReminderCustomer | null {
  const id = asString(row.id);
  if (!id) return null;
  return {
    id,
    is_active: asBool(row.is_active, true),
    visit_reminders: asBool(row.visit_reminders, false),
    preferred_channel: asString(row.preferred_channel),
    phone_e164: asString(row.phone_e164),
  };
}

/**
 * Plans and sends today's reminders for one business.
 * One stop's send failure never stops the rest. Jobs / customers / told-about
 * query errors throw so the evening cron can record the tenant in `errors`.
 */
export async function runRemindersForTenant(
  admin: SupabaseClient,
  tenantId: string,
  now: Date = new Date(),
): Promise<ReminderCounts> {
  const counts = emptyCounts();
  const ctx = await getTenantMessagingContext(admin, tenantId);
  if (!ctx || !ctx.settings.reminders_enabled) return counts;

  const targetDate = reminderTargetDate(
    todayInLondon(now),
    ctx.settings.reminder_days_before,
  );
  counts.targetDate = targetDate;

  const { data: jobRows, error: jobError } = await admin
    .from('jobs')
    .select(
      'id, customer_id, service_agreement_id, status, scheduled_date, scheduled_time, address, postcode, route_position, custom_fields, job_description, service_agreements(reminder_enabled)',
    )
    .eq('tenant_id', tenantId)
    .eq('scheduled_date', targetDate)
    .eq('status', 'assigned')
    .not('service_agreement_id', 'is', null);

  if (jobError) {
    console.error('[runRemindersForTenant] jobs', jobError.message);
    throw new Error(jobError.message);
  }

  const visits: ReminderVisit[] = [];
  const customerIds = new Set<string>();
  for (const raw of jobRows ?? []) {
    const visit = mapVisit(raw as unknown as Record<string, unknown>);
    if (!visit) continue;
    visits.push(visit);
    if (visit.customer_id) customerIds.add(visit.customer_id);
  }

  const customers = new Map<string, ReminderCustomer>();
  if (customerIds.size > 0) {
    const { data: customerRows, error: customerError } = await admin
      .from('customers')
      .select('id, is_active, visit_reminders, preferred_channel, phone_e164')
      .eq('tenant_id', tenantId)
      .in('id', [...customerIds]);

    if (customerError) {
      console.error(
        '[runRemindersForTenant] customers',
        customerError.message,
      );
      throw new Error(customerError.message);
    }

    for (const raw of customerRows ?? []) {
      const customer = mapCustomer(raw as unknown as Record<string, unknown>);
      if (customer) customers.set(customer.id, customer);
    }
  }

  const fourteenDaysAgo = new Date(
    now.getTime() - 14 * 86_400_000,
  ).toISOString();
  const { data: toldRows, error: toldError } = await admin
    .from('messages')
    .select('job_ids')
    .eq('tenant_id', tenantId)
    .eq('kind', 'visit_change')
    .eq('direction', 'outbound')
    .in('status', ['sent', 'delivered', 'held'])
    .gte('created_at', fourteenDaysAgo);

  if (toldError) {
    console.error('[runRemindersForTenant] told', toldError.message);
    throw new Error(toldError.message);
  }

  const toldAboutJobIds = new Set<string>();
  for (const raw of toldRows ?? []) {
    const jobIds = (raw as { job_ids?: unknown }).job_ids;
    if (!Array.isArray(jobIds)) continue;
    for (const id of jobIds) {
      if (typeof id === 'string' && id) toldAboutJobIds.add(id);
    }
  }

  const plans = planReminders({
    visits,
    customers,
    remindersEnabled: ctx.settings.reminders_enabled,
    toldAboutJobIds,
  });
  counts.planned = plans.length;

  const brand = {
    businessName: ctx.businessName,
    contactPhone: ctx.contactPhone,
  };

  for (const plan of plans) {
    try {
      const door = await sendCustomerMessage({
        tenantId,
        customerId: plan.customerId,
        kind: 'reminder',
        dedupeKey: plan.dedupeKey,
        text: ({ firstText }) =>
          reminderSms({
            brand,
            address: plan.address,
            day: formatVisitDay(plan.date),
            services: plan.services,
            time: plan.time,
            firstText,
          }),
        email: null,
        jobIds: plan.jobIds,
        bindThread: true,
        now,
      });

      switch (door.outcome) {
        case 'text_sent':
          counts.sent += 1;
          break;
        case 'text_held':
          counts.held += 1;
          break;
        case 'duplicate':
          counts.duplicate += 1;
          break;
        case 'skipped':
          if (door.reason === 'no_texts_left') {
            counts.skippedNoTexts += 1;
          } else {
            counts.skipped += 1;
          }
          break;
        case 'failed':
          counts.failed += 1;
          break;
        case 'email_sent':
          // Reminders never email; treat as unexpected failure.
          counts.failed += 1;
          break;
      }
    } catch (err) {
      counts.failed += 1;
      console.error(
        '[runRemindersForTenant] plan',
        plan.dedupeKey,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return counts;
}
