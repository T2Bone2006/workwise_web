import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { composeDirectDebitInvite } from '@/lib/direct-debit/messages';
import { getDirectDebitState } from '@/lib/direct-debit/state';
import { customerEmailFrom, emailDocument } from '@/lib/emails/visit-done';
import { GoCardlessError } from '@/lib/gocardless/client';
import { clientForTenant } from '@/lib/gocardless/connection';
import { getTenantMessagingContext } from '@/lib/messaging/brand';
import { sendCustomerMessage } from '@/lib/messaging/send';
import { ensurePayLinkToken } from '@/lib/payments/money-core';
import { appBaseUrl, payLinkUrl } from '@/lib/payments/tokens';
import { splitHouse } from '@/lib/rounds/house';
import { todayInLondon } from '@/lib/rounds/dates';

export type StartSetupResult =
  | { ok: true; url: string }
  | { ok: false; reason: 'not_available' | 'already_set_up' | 'customer_not_found' | 'provider_error' };

const TITLES = new Set(['MR', 'MRS', 'MS', 'MISS', 'DR', 'MX']);

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * Splits a WorkWise name for GoCardless: 'Mrs Jane Wright' → { given: 'Jane',
 * family: 'Wright' }; one word → { given: word, family: word }; a business
 * customer (type 'business' / 'bulk_client', or a company name) → { company }. Pure.
 */
export function payerNameParts(p: {
  name: string;
  companyName: string | null;
  type: string | null;
}): { given: string; family: string } | { company: string } {
  const company = p.companyName?.trim();
  if (company) return { company };
  if (p.type === 'business' || p.type === 'bulk_client') return { company: p.name.trim() };

  const words = p.name.trim().split(/\s+/).filter(Boolean);
  const named = words.filter(
    (word, i) => !(i === 0 && words.length > 1 && TITLES.has(word.replace(/\./g, '').toUpperCase())),
  );
  if (named.length === 0) return { given: p.name.trim(), family: p.name.trim() };
  if (named.length === 1) return { given: named[0], family: named[0] };
  return { given: named[0], family: named.slice(1).join(' ') };
}

async function customerAddress(
  admin: SupabaseClient,
  tenantId: string,
  customerId: string,
  billingAddress: string | null,
): Promise<{ line1: string | null; postcode: string | null }> {
  const { data } = await admin
    .from('service_agreements')
    .select('address, postcode, created_at')
    .eq('tenant_id', tenantId)
    .eq('customer_id', customerId)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1);
  const agreement = (Array.isArray(data) ? data[0] : null) as
    | { address?: unknown; postcode?: unknown }
    | null;
  if (agreement && str(agreement.address)) {
    return {
      line1: str(str(agreement.address)?.split(',')[0]),
      postcode: str(agreement.postcode),
    };
  }
  const home = splitHouse(billingAddress);
  return {
    line1: str(home.address.split(',')[0]),
    postcode: str(home.postcode),
  };
}

/**
 * What GoCardless's page is pre-filled with for a customer (name split for a
 * person or a company, email, first address line and postcode). `customer`
 * is a customers row with id, name, email, type, company_name, billing_address.
 */
export async function prefilledCustomerFor(
  admin: SupabaseClient,
  tenantId: string,
  customer: Record<string, unknown>,
): Promise<Record<string, string>> {
  const parts = payerNameParts({
    name: str(customer.name) ?? '',
    companyName: str(customer.company_name),
    type: str(customer.type),
  });
  const address = await customerAddress(
    admin,
    tenantId,
    String(customer.id),
    str(customer.billing_address),
  );
  const prefilled: Record<string, string> = { country_code: 'GB' };
  if ('company' in parts) prefilled.company_name = parts.company;
  else {
    prefilled.given_name = parts.given;
    prefilled.family_name = parts.family;
  }
  const email = str(customer.email);
  if (email) prefilled.email = email;
  if (address.line1) prefilled.address_line1 = address.line1;
  if (address.postcode) prefilled.postal_code = address.postcode;
  return prefilled;
}

function logProvider(label: string, err: unknown): void {
  if (err instanceof GoCardlessError) {
    console.error(label, { status: err.status, type: err.type, reasons: err.reasons });
  } else {
    console.error(label, err instanceof Error ? err.name : 'error');
  }
}

/** Creates a GoCardless billing request + flow for this customer and returns GoCardless's page URL. */
export async function startDirectDebitSetup(
  admin: SupabaseClient,
  p: { tenantId: string; customerId: string; payToken: string },
): Promise<StartSetupResult> {
  // 1.
  if ((await getDirectDebitState(admin, p.tenantId)) !== 'on') {
    return { ok: false, reason: 'not_available' };
  }
  const unlocked = await clientForTenant(admin, p.tenantId);
  if (!unlocked?.connection.organisation_id) return { ok: false, reason: 'not_available' };
  const { client, connection } = unlocked;

  // 2.
  const { data: customerData } = await admin
    .from('customers')
    .select('id, name, email, type, company_name, billing_address')
    .eq('id', p.customerId)
    .eq('tenant_id', p.tenantId)
    .maybeSingle();
  const customer = customerData as Record<string, unknown> | null;
  const name = str(customer?.name);
  if (!customer || !name) return { ok: false, reason: 'customer_not_found' };

  const { data: existing } = await admin
    .from('customer_direct_debits')
    .select('id, status, gocardless_customer_id, created_at')
    .eq('tenant_id', p.tenantId)
    .eq('customer_id', p.customerId)
    .order('created_at', { ascending: false });
  const rows = (existing ?? []) as { id: string; status: string; gocardless_customer_id: string | null }[];
  if (rows.some((row) => row.status === 'pending' || row.status === 'active')) {
    return { ok: false, reason: 'already_set_up' };
  }
  const previousGcCustomer = rows.map((row) => str(row.gocardless_customer_id)).find(Boolean) ?? null;

  // 3. Abandoned GoCardless pages.
  await admin
    .from('customer_direct_debits')
    .delete()
    .eq('tenant_id', p.tenantId)
    .eq('customer_id', p.customerId)
    .eq('status', 'setting_up');

  try {
    // 4.
    const minute = Math.floor(Date.now() / 60_000);
    const billingRequest = await client.post<{ billing_requests?: { id?: string } }>(
      '/billing_requests',
      {
        billing_requests: {
          mandate_request: { scheme: 'bacs', currency: 'GBP' },
          metadata: {
            workwise_tenant_id: p.tenantId,
            workwise_customer_id: p.customerId,
            workwise_kind: 'dd_setup',
          },
          ...(previousGcCustomer ? { links: { customer: previousGcCustomer } } : {}),
        },
      },
      { idempotencyKey: `ddsetup_${p.customerId}_${minute}` },
    );
    const billingRequestId = str(billingRequest.billing_requests?.id);
    if (!billingRequestId) {
      console.error('[direct-debit] billing request without an id');
      return { ok: false, reason: 'provider_error' };
    }

    // 5.
    const prefilled = await prefilledCustomerFor(admin, p.tenantId, customer);

    const app = appBaseUrl();
    const token = encodeURIComponent(p.payToken);
    const flow = await client.post<{ billing_request_flows?: { authorisation_url?: string } }>(
      '/billing_request_flows',
      {
        billing_request_flows: {
          redirect_uri: `${app}/pay/${token}?dd=done`,
          exit_uri: `${app}/pay/${token}?dd=cancelled`,
          lock_currency: true,
          show_success_redirect_button: true,
          prefilled_customer: prefilled,
          links: { billing_request: billingRequestId },
        },
      },
      { idempotencyKey: `ddflow_${billingRequestId}` },
    );
    const url = str(flow.billing_request_flows?.authorisation_url);
    if (!url) {
      console.error('[direct-debit] flow without a url');
      return { ok: false, reason: 'provider_error' };
    }

    // 6. The webhook (step 11) also finds the customer from the billing request's metadata.
    const { error: insertError } = await admin.from('customer_direct_debits').insert({
      tenant_id: p.tenantId,
      customer_id: p.customerId,
      gocardless_organisation_id: connection.organisation_id,
      gocardless_billing_request_id: billingRequestId,
      source: 'workwise',
      status: 'setting_up',
    });
    if (insertError) {
      console.error('[direct-debit] setting_up row', insertError.code);
    }

    // 7.
    return { ok: true, url };
  } catch (err) {
    logProvider('[direct-debit] startDirectDebitSetup', err);
    return { ok: false, reason: 'provider_error' };
  }
}

/** The link the trader sends: the customer's pay page with ?dd=1 (the pay page highlights Direct Debit). */
export async function directDebitInviteUrl(
  admin: SupabaseClient,
  p: { tenantId: string; customerId: string },
): Promise<string | null> {
  const token = await ensurePayLinkToken(admin, p);
  return token ? `${payLinkUrl(token)}?dd=1` : null;
}

/**
 * The link to copy/share for a customer plus the ready-made share text (dashboard
 * and phone). Needs the business to be On and the customer to belong to it.
 */
export async function getDirectDebitLink(
  admin: SupabaseClient,
  p: { tenantId: string; customerId: string },
): Promise<{ ok: true; url: string; shareText: string } | { ok: false; error: string }> {
  if ((await getDirectDebitState(admin, p.tenantId)) !== 'on') {
    return { ok: false, error: "Direct Debit isn't on yet — connect GoCardless in Settings → Payments." };
  }
  const { data: customer } = await admin
    .from('customers')
    .select('id, name')
    .eq('id', p.customerId)
    .eq('tenant_id', p.tenantId)
    .maybeSingle();
  if (!customer) return { ok: false, error: 'Customer not found.' };

  const [ctx, url, { data: balance }] = await Promise.all([
    getTenantMessagingContext(admin, p.tenantId),
    directDebitInviteUrl(admin, p),
    admin
      .from('customer_balances')
      .select('owed_amount')
      .eq('tenant_id', p.tenantId)
      .eq('customer_id', p.customerId)
      .maybeSingle(),
  ]);
  if (!ctx || !url) return { ok: false, error: 'Could not make the link — try again.' };

  const owed = Number((balance as { owed_amount?: unknown } | null)?.owed_amount);
  const invite = composeDirectDebitInvite({
    businessName: ctx.businessName,
    customerName: str((customer as { name?: unknown }).name) ?? '',
    url,
    contactPhone: ctx.contactPhone,
    owedNow: Number.isFinite(owed) ? owed : 0,
  });
  return { ok: true, url, shareText: invite.share };
}

const NO_CONTACT = 'No email or mobile for this customer — copy the link instead.';

/** Sends the invitation through sendCustomerMessage (kind 'dd_invite', money order, dedupe key `dd_invite:<customerId>:<YYYY-MM-DD>`). */
export async function sendDirectDebitInvite(
  admin: SupabaseClient,
  p: { tenantId: string; customerId: string },
): Promise<{ ok: true; channel: 'email' | 'sms' } | { ok: false; error: string }> {
  if ((await getDirectDebitState(admin, p.tenantId)) !== 'on') {
    return { ok: false, error: "Direct Debit isn't on for your business yet." };
  }

  const { data: customerData } = await admin
    .from('customers')
    .select('id, name, email, phone_e164')
    .eq('id', p.customerId)
    .eq('tenant_id', p.tenantId)
    .maybeSingle();
  const customer = customerData as Record<string, unknown> | null;
  if (!customer) return { ok: false, error: 'Customer not found.' };
  const customerEmail = str(customer.email);
  if (!customerEmail && !str(customer.phone_e164)) return { ok: false, error: NO_CONTACT };

  const [ctx, url, { data: balance }] = await Promise.all([
    getTenantMessagingContext(admin, p.tenantId),
    directDebitInviteUrl(admin, p),
    admin
      .from('customer_balances')
      .select('owed_amount')
      .eq('tenant_id', p.tenantId)
      .eq('customer_id', p.customerId)
      .maybeSingle(),
  ]);
  if (!ctx || !url) return { ok: false, error: 'Could not send the invitation — try again.' };

  const owedRaw = (balance as { owed_amount?: unknown } | null)?.owed_amount;
  const owedNow = Number(owedRaw);
  const invite = composeDirectDebitInvite({
    businessName: ctx.businessName,
    customerName: str(customer.name) ?? '',
    url,
    contactPhone: ctx.contactPhone,
    owedNow: Number.isFinite(owedNow) ? owedNow : 0,
  });

  const brand = { businessName: ctx.businessName, logoUrl: ctx.logoUrl };
  const signOff = `Thanks,\n${ctx.businessName}`;
  const [before, after] = [invite.emailParagraphs.slice(0, 2), invite.emailParagraphs.slice(2)];
  const text = [invite.greeting, '', ...before, url, '', ...after, '', signOff].join('\n');

  const outcome = await sendCustomerMessage({
    tenantId: p.tenantId,
    customerId: p.customerId,
    kind: 'dd_invite',
    dedupeKey: `dd_invite:${p.customerId}:${todayInLondon()}`,
    text: () => invite.sms,
    email: customerEmail
      ? async () => {
          const html = emailDocument({
            subject: invite.subject,
            brand,
            greeting: invite.greeting,
            paragraphs: before,
            payUrl: url,
            payLabel: 'Set up Direct Debit',
            afterButton: after,
            bankLine: null,
            signOff,
          });
          try {
            const { resend } = await import('@/lib/resend');
            const { error } = await resend.emails.send({
              from: customerEmailFrom(ctx.businessName),
              to: customerEmail,
              subject: invite.subject,
              html,
              text,
              ...(ctx.replyToEmail ? { replyTo: ctx.replyToEmail } : {}),
            });
            if (error) {
              console.error('[direct-debit] invite email', error.message);
              return { sent: false, error: error.message };
            }
            return { sent: true };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error('[direct-debit] invite email', message);
            return { sent: false, error: message };
          }
        }
      : null,
  });

  switch (outcome.outcome) {
    case 'email_sent':
      return { ok: true, channel: 'email' };
    case 'text_sent':
    case 'text_held':
      return { ok: true, channel: 'sms' };
    case 'duplicate':
      return { ok: false, error: 'The invitation was already sent today.' };
    case 'skipped':
      switch (outcome.reason) {
        case 'no_messages':
          return { ok: false, error: 'This customer is set to No messages — copy the link instead.' };
        case 'opted_out':
          return { ok: false, error: 'This customer has opted out of texts — copy the link instead.' };
        case 'no_texts_left':
          return { ok: false, error: 'No texts left this month — copy the link instead.' };
        case 'customer_inactive':
          return { ok: false, error: 'Customer not found.' };
        default:
          return { ok: false, error: NO_CONTACT };
      }
    default:
      return { ok: false, error: 'Could not send the invitation — try again.' };
  }
}
