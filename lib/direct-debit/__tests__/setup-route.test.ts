import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadCustomerPayPage = vi.fn();
const startDirectDebitSetup = vi.fn();

vi.mock('@/lib/data/payments/public-pay', () => ({
  loadCustomerPayPage: (token: string) => loadCustomerPayPage(token),
}));
vi.mock('@/lib/direct-debit/setup', () => ({
  startDirectDebitSetup: (_admin: unknown, p: unknown) => startDirectDebitSetup(p),
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));

import { POST } from '@/app/api/pay/direct-debit/route';

const TOKEN = 'tok_abcdefghijklmnopqrstuvwxyz';

function post(token?: string): Request {
  const body = new FormData();
  if (token != null) body.set('token', token);
  return new Request('http://localhost:3000/api/pay/direct-debit', { method: 'POST', body });
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.test';
  loadCustomerPayPage.mockReset();
  startDirectDebitSetup.mockReset();
});

describe('POST /api/pay/direct-debit', () => {
  it('unknown or missing token → back to the pay page with error=invalid', async () => {
    loadCustomerPayPage.mockResolvedValue(null);
    const res = await POST(post(TOKEN));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`https://app.example.test/pay/${TOKEN}?error=invalid`);

    const empty = await POST(post());
    expect(empty.status).toBe(303);
    expect(empty.headers.get('location')).toBe('https://app.example.test/pay/?error=invalid');
    expect(startDirectDebitSetup).not.toHaveBeenCalled();
  });

  it('ok → 303 to GoCardless', async () => {
    loadCustomerPayPage.mockResolvedValue({ business: { tenantId: 'T1' }, customerId: 'C1' });
    startDirectDebitSetup.mockResolvedValue({ ok: true, url: 'https://pay-sandbox.gocardless.com/flow/BRF1' });
    const res = await POST(post(TOKEN));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://pay-sandbox.gocardless.com/flow/BRF1');
    expect(startDirectDebitSetup).toHaveBeenCalledWith({ tenantId: 'T1', customerId: 'C1', payToken: TOKEN });
  });

  it('refused → back with dd=<reason>; a crash → dd=provider_error, never 500', async () => {
    loadCustomerPayPage.mockResolvedValue({ business: { tenantId: 'T1' }, customerId: 'C1' });
    startDirectDebitSetup.mockResolvedValueOnce({ ok: false, reason: 'already_set_up' });
    const refused = await POST(post(TOKEN));
    expect(refused.headers.get('location')).toBe(`https://app.example.test/pay/${TOKEN}?dd=already_set_up`);

    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    startDirectDebitSetup.mockRejectedValueOnce(new Error('boom'));
    const crashed = await POST(post(TOKEN));
    expect(crashed.status).toBe(303);
    expect(crashed.headers.get('location')).toBe(`https://app.example.test/pay/${TOKEN}?dd=provider_error`);
    errorLog.mockRestore();
  });
});
