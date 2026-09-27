import { NextResponse } from 'next/server';
import { loadCustomerPayPage, loadInvoiceByToken } from '@/lib/data/payments/public-pay';
import { getPaymentSettings } from '@/lib/data/payments/settings';
import { checkoutAmountPence } from '@/lib/payments/connect-status';
import { getAppUrl, getStripe } from '@/lib/stripe/client';
import { ConnectMismatchError, retrieveVerifiedAccount } from '@/lib/stripe/connect';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

type CheckoutKind = 'customer' | 'invoice';

function pagePath(kind: string, token: string): string {
  const safe = encodeURIComponent(token);
  return kind === 'invoice' ? `/pay/i/${safe}` : `/pay/${safe}`;
}

function redirectBack(kind: string, token: string, error?: string): NextResponse {
  const url = new URL(pagePath(kind, token), getAppUrl());
  if (error) url.searchParams.set('error', error);
  return NextResponse.redirect(url, 303);
}

function emailOrUndefined(value: string | null | undefined): string | undefined {
  const email = value?.trim();
  if (!email || !email.includes('@')) return undefined;
  return email;
}

export async function POST(request: Request): Promise<NextResponse> {
  let token = '';
  let kind: CheckoutKind | '' = '';

  try {
    const form = await request.formData();
    token = String(form.get('token') ?? '');
    const rawKind = String(form.get('kind') ?? '');
    if (rawKind === 'customer' || rawKind === 'invoice') kind = rawKind;
  } catch (error) {
    console.error('[pay/checkout] form', error);
    return redirectBack('customer', '', 'invalid');
  }

  if (!kind) {
    return redirectBack('customer', token, 'invalid');
  }

  try {
    if (kind === 'customer') {
      return await startCustomerCheckout(token);
    }
    return await startInvoiceCheckout(token);
  } catch (error) {
    console.error('[pay/checkout]', error);
    return redirectBack(kind, token, 'invalid');
  }
}

async function startCustomerCheckout(token: string): Promise<NextResponse> {
  const page = await loadCustomerPayPage(token);
  if (!page) return redirectBack('customer', token, 'invalid');

  const amount = checkoutAmountPence(page.owedAmount);
  if (!amount.ok) return redirectBack('customer', token, amount.reason);

  const admin = createAdminClient();
  const settings = await getPaymentSettings(admin, page.business.tenantId);
  const accountId = settings.connect.accountId;
  if (!page.card.enabled || settings.connect.status !== 'active' || !accountId) {
    console.error('[pay/checkout] card unavailable', {
      tenantId: page.business.tenantId,
      enabled: page.card.enabled,
      status: settings.connect.status,
    });
    return redirectBack('customer', token, 'unavailable');
  }

  try {
    await retrieveVerifiedAccount(page.business.tenantId, accountId);
  } catch (error) {
    const reason = error instanceof ConnectMismatchError ? 'tenant mismatch' : error;
    console.error('[pay/checkout] account verify', reason);
    return redirectBack('customer', token, 'unavailable');
  }

  const { data: customer } = await admin
    .from('customers')
    .select('email')
    .eq('id', page.customerId)
    .eq('tenant_id', page.business.tenantId)
    .maybeSingle();
  const email = emailOrUndefined(
    (customer as { email?: string | null } | null)?.email,
  );

  const n = page.unpaidVisits.length;
  const app = getAppUrl();
  const session = await getStripe().checkout.sessions.create(
    {
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'gbp',
            unit_amount: amount.pence,
            product_data: {
              name: `Payment to ${page.business.name}`,
              description: `${n} visit${n === 1 ? '' : 's'} · ref ${page.reference ?? ''}`.trim(),
            },
          },
        },
      ],
      ...(email ? { customer_email: email } : {}),
      payment_intent_data: {
        description: `WorkWise pay link · ${page.business.name}`,
        ...(email ? { receipt_email: email } : {}),
        metadata: {
          workwise_kind: 'pay_link',
          workwise_tenant_id: page.business.tenantId,
          customer_id: page.customerId,
          invoice_id: '',
        },
      },
      metadata: {
        workwise_kind: 'pay_link',
        workwise_tenant_id: page.business.tenantId,
        customer_id: page.customerId,
        invoice_id: '',
      },
      success_url: `${app}/pay/${token}?paid=1`,
      cancel_url: `${app}/pay/${token}`,
      expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
    },
    { stripeAccount: accountId },
  );

  if (!session.url) return redirectBack('customer', token, 'invalid');
  return NextResponse.redirect(session.url, 303);
}

async function startInvoiceCheckout(token: string): Promise<NextResponse> {
  const loaded = await loadInvoiceByToken(token);
  if (!loaded) return redirectBack('invoice', token, 'invalid');

  const { invoice, business, card } = loaded;
  if (invoice.status === 'void') return redirectBack('invoice', token, 'invalid');

  const amount = checkoutAmountPence(invoice.balanceDue);
  if (!amount.ok) return redirectBack('invoice', token, amount.reason);

  const admin = createAdminClient();
  const settings = await getPaymentSettings(admin, business.tenantId);
  const accountId = settings.connect.accountId;
  if (!card.enabled || settings.connect.status !== 'active' || !accountId) {
    console.error('[pay/checkout] card unavailable', {
      tenantId: business.tenantId,
      invoiceId: invoice.id,
      enabled: card.enabled,
      status: settings.connect.status,
    });
    return redirectBack('invoice', token, 'unavailable');
  }

  try {
    await retrieveVerifiedAccount(business.tenantId, accountId);
  } catch (error) {
    const reason = error instanceof ConnectMismatchError ? 'tenant mismatch' : error;
    console.error('[pay/checkout] account verify', reason);
    return redirectBack('invoice', token, 'unavailable');
  }

  const email = emailOrUndefined(invoice.billTo.email);
  const app = getAppUrl();
  const session = await getStripe().checkout.sessions.create(
    {
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'gbp',
            unit_amount: amount.pence,
            product_data: {
              name: `Invoice ${invoice.number} — ${business.name}`,
            },
          },
        },
      ],
      ...(email ? { customer_email: email } : {}),
      payment_intent_data: {
        description: `WorkWise pay link · ${business.name}`,
        ...(email ? { receipt_email: email } : {}),
        metadata: {
          workwise_kind: 'pay_link',
          workwise_tenant_id: business.tenantId,
          customer_id: invoice.customerId,
          invoice_id: invoice.id,
        },
      },
      metadata: {
        workwise_kind: 'pay_link',
        workwise_tenant_id: business.tenantId,
        customer_id: invoice.customerId,
        invoice_id: invoice.id,
      },
      success_url: `${app}/pay/i/${token}?paid=1`,
      cancel_url: `${app}/pay/i/${token}`,
      expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
    },
    { stripeAccount: accountId },
  );

  if (!session.url) return redirectBack('invoice', token, 'invalid');
  return NextResponse.redirect(session.url, 303);
}
