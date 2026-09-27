import Stripe from 'stripe';
import { buildConnectAccountParams, CONNECT_API_VERSION } from '../lib/stripe/connect-params';

function printStripeError(err: unknown): void {
  if (err instanceof Stripe.errors.StripeError) {
    console.error('error.type:', err.type);
    console.error('error.code:', err.code);
    console.error('error.param:', err.param);
    console.error('error.message:', err.message);
    return;
  }
  console.error(err);
}

async function main(): Promise<void> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key?.startsWith('sk_test_')) {
    console.error('Probe runs in TEST mode only');
    process.exit(1);
  }

  const stripe = new Stripe(key, {
    apiVersion: CONNECT_API_VERSION as Stripe.LatestApiVersion,
  });
  const keep = process.argv.includes('--keep');
  let accountId: string | undefined;

  try {
    const account = await stripe.accounts.create(
      buildConnectAccountParams({
        tenantId: 'probe-' + Date.now(),
        email: 'probe@example.com',
        businessName: 'Probe Window Cleaning',
      }),
    );
    accountId = account.id;

    console.log('id:', account.id);
    console.log('controller:', JSON.stringify(account.controller));
    console.log('type:', account.type);
    console.log('capabilities:', JSON.stringify(account.capabilities));
    console.log('requirements.currently_due:', JSON.stringify(account.requirements?.currently_due));
    console.log('tos_acceptance.service_agreement:', account.tos_acceptance?.service_agreement);
    console.log('metadata:', JSON.stringify(account.metadata));

    const link = await stripe.accountLinks.create({
      account: account.id,
      type: 'account_onboarding',
      refresh_url: 'https://example.com/refresh',
      return_url: 'https://example.com/return',
      collection_options: { fields: 'eventually_due' },
    });
    console.log('Open this to see the onboarding screens (test mode):');
    console.log(link.url);

    if (!keep) {
      await stripe.accounts.del(account.id);
      accountId = undefined;
      console.log('Deleted test account');
    }
  } catch (err) {
    printStripeError(err);
    if (accountId && !keep) {
      try {
        await stripe.accounts.del(accountId);
        console.error('Deleted test account');
      } catch (deleteErr) {
        printStripeError(deleteErr);
      }
    }
    process.exit(1);
  }
}

void main();
