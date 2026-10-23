'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentUserRow } from '@/lib/data/tenant';
import { getWebsiteEligible } from '@/lib/data/website-offer';
import { planLabel, summariseLite, type SubscriptionRow } from '@/lib/data/admin-website';
import { sendWebsiteRequestEmail } from '@/lib/emails/website-request';
import { requireAdmin } from '@/lib/utils/admin';
import { isWebsiteStatus, type WebsiteStatus } from '@/lib/website-offer';

export type WebsiteAnswerResult = { ok: true; status: 'needs' | 'has_one' } | { ok: false; error: string };
export type WebsiteAdminResult = { ok: true } | { ok: false; error: string };

const SAVE_FAIL = "Couldn't save that. Please try again.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function settingsPhone(settings: unknown): string | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  const record = settings as { company?: { phone?: unknown }; messaging?: { contact_phone?: unknown } };
  const contact = record.messaging?.contact_phone;
  if (typeof contact === 'string' && contact.trim()) return contact.trim();
  const phone = record.company?.phone;
  return typeof phone === 'string' && phone.trim() ? phone.trim() : null;
}

function formatDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' });
}

function refreshPages() {
  revalidatePath('/lite');
  revalidatePath('/lite/setup');
  revalidatePath('/admin/website');
}

/**
 * The Lite customer's answer to "do you need a website?". Saved first, then the owner is emailed on a yes. A second
 * answer for the same business changes nothing and sends nothing, so there is one email per customer.
 */
export async function answerWebsiteOffer(answer: 'needs' | 'has_one'): Promise<WebsiteAnswerResult> {
  if (answer !== 'needs' && answer !== 'has_one') return { ok: false, error: SAVE_FAIL };
  const eligible = await getWebsiteEligible();
  if (!eligible) return { ok: false, error: 'The free website comes with Lite.' };

  const admin = createAdminClient();
  const { error } = await admin.from('website_requests').insert({ tenant_id: eligible.tenantId, status: answer });
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      refreshPages();
      return { ok: true, status: answer };
    }
    console.error('[website-offer] save failed', (error as { code?: string }).code ?? 'insert');
    return { ok: false, error: SAVE_FAIL };
  }
  refreshPages();
  if (answer === 'has_one') return { ok: true, status: answer };

  const to = process.env.SETUP_REQUEST_EMAIL?.trim();
  if (!to) {
    console.error('[website-offer] SETUP_REQUEST_EMAIL not set: request saved, owner not emailed');
    return { ok: true, status: answer };
  }
  try {
    const [{ data: tenant }, { data: subs }, userRow] = await Promise.all([
      admin.from('tenants').select('name, settings').eq('id', eligible.tenantId).maybeSingle(),
      admin
        .from('subscriptions')
        .select(
          'tenant_id, product, plan, status, source, billing_interval, created_at, cancel_at_period_end, canceled_at, current_period_end',
        )
        .eq('tenant_id', eligible.tenantId),
      getCurrentUserRow(),
    ]);
    const { data: person } = await admin.from('users').select('full_name').eq('id', eligible.userId).maybeSingle();
    const rows = (subs ?? []) as SubscriptionRow[];
    const lite = summariseLite(rows);
    const interval = rows.find((s) => s.billing_interval === 'year' || s.billing_interval === 'month')?.billing_interval;
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.joinworkwise.com').replace(/\/+$/, '');
    await sendWebsiteRequestEmail({
      to,
      replyTo: userRow?.email ?? null,
      businessName: (tenant as { name?: string | null } | null)?.name ?? '',
      tenantId: eligible.tenantId,
      name: (person as { full_name?: string | null } | null)?.full_name ?? null,
      email: userRow?.email ?? null,
      phone: settingsPhone((tenant as { settings?: unknown } | null)?.settings),
      plan: `${planLabel(rows)}${interval === 'year' ? ', yearly' : interval === 'month' ? ', monthly' : ''}`,
      signedUp: lite ? formatDay(lite.startedAt) : 'unknown',
      keepFrom: lite ? formatDay(lite.keepFrom) : 'unknown',
      trackerUrl: `${appUrl}/admin/website`,
    });
  } catch {
    console.error('[website-offer] could not build the owner email');
  }
  return { ok: true, status: answer };
}

/** Owner only. Sets where a business is on the website, with the live address and a note. */
export async function updateWebsiteRequest(
  tenantId: string,
  _prev: WebsiteAdminResult | null,
  formData: FormData,
): Promise<WebsiteAdminResult> {
  await requireAdmin();
  if (!UUID.test(tenantId)) return { ok: false, error: SAVE_FAIL };
  const status = formData.get('status');
  if (!isWebsiteStatus(status)) return { ok: false, error: 'Pick a status.' };

  const urlRaw = String(formData.get('liveUrl') ?? '').trim();
  let liveUrl: string | null = null;
  if (urlRaw) {
    const withScheme = /^https?:\/\//i.test(urlRaw) ? urlRaw : `https://${urlRaw}`;
    try {
      const parsed = new URL(withScheme);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('scheme');
      liveUrl = parsed.toString().slice(0, 300);
    } catch {
      return { ok: false, error: "That web address doesn't look right." };
    }
  }
  const notes = String(formData.get('notes') ?? '').trim();
  if (notes.length > 2000) return { ok: false, error: 'Keep the note under 2000 characters.' };

  const admin = createAdminClient();
  const { data: existing, error: readError } = await admin
    .from('website_requests')
    .select('status, done_at')
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (readError) return { ok: false, error: SAVE_FAIL };

  const wasDone = (existing as { done_at?: string | null } | null)?.done_at ?? null;
  const done_at = status === 'done' ? (wasDone ?? new Date().toISOString()) : status === 'taken_down' ? wasDone : null;
  const row = { tenant_id: tenantId, status: status as WebsiteStatus, live_url: liveUrl, notes: notes || null, done_at };
  const { error } = existing
    ? await admin.from('website_requests').update(row).eq('tenant_id', tenantId)
    : await admin.from('website_requests').insert(row);
  if (error) {
    console.error('[website-offer] admin update failed', (error as { code?: string }).code ?? 'write');
    return { ok: false, error: SAVE_FAIL };
  }
  revalidatePath('/admin/website');
  return { ok: true };
}
