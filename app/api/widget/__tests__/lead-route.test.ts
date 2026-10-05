import { beforeEach, describe, expect, it, vi } from 'vitest';

const { guardWidgetRequest, verifyWidgetSession, createLeadFromWidget, preflightResponse } = vi.hoisted(() => ({
  guardWidgetRequest: vi.fn(),
  verifyWidgetSession: vi.fn(),
  createLeadFromWidget: vi.fn(),
  preflightResponse: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({}),
}));

vi.mock('@/lib/widget/guard', () => ({
  guardWidgetRequest: (...args: unknown[]) => guardWidgetRequest(...args),
  preflightResponse: (...args: unknown[]) => preflightResponse(...args),
}));

vi.mock('@/lib/widget/session', () => ({
  verifyWidgetSession: (...args: unknown[]) => verifyWidgetSession(...args),
}));

vi.mock('@/lib/lite/leads-core', () => ({
  createLeadFromWidget: (...args: unknown[]) => createLeadFromWidget(...args),
}));

import { OPTIONS, POST } from '@/app/api/widget/lead/route';

const body = {
  clientId: '11111111-1111-4111-8111-111111111111',
  conversationId: '22222222-2222-4222-8222-222222222222',
  session: 'session-token-value',
  name: 'Sam',
  mobile: '07700 900123',
  postcode: 'M20 6AB',
  email: '',
  preferredDays: ['mon'],
  note: '',
  wantsBooking: true,
};

function request(payload: unknown): Request {
  return new Request('http://localhost:3000/api/widget/lead', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://daveplastering.co.uk' },
    body: JSON.stringify(payload),
  });
}

beforeEach(() => {
  guardWidgetRequest.mockReset();
  verifyWidgetSession.mockReset();
  createLeadFromWidget.mockReset();
  preflightResponse.mockReset();
  guardWidgetRequest.mockResolvedValue({
    ok: true,
    widget: { id: body.clientId, tenant_id: 'tenant-1' },
    originHost: 'daveplastering.co.uk',
    cors: { 'Access-Control-Allow-Origin': 'https://daveplastering.co.uk' },
  });
  verifyWidgetSession.mockReturnValue(true);
  createLeadFromWidget.mockResolvedValue({ ok: true, leadId: 'lead-1', duplicate: false, autoAccepted: false });
});

describe('POST /api/widget/lead', () => {
  it('rejects a body that does not parse', async () => {
    const response = await POST(request({}));
    expect(response.status).toBe(400);
    expect(guardWidgetRequest).not.toHaveBeenCalled();
  });

  it('returns the guard response for a wrong website or a cancelled Lite account', async () => {
    guardWidgetRequest.mockResolvedValue({
      ok: false,
      response: Response.json({ active: false }, { status: 403 }),
    });
    const response = await POST(request(body));
    expect(response.status).toBe(403);
    expect(createLeadFromWidget).not.toHaveBeenCalled();
  });

  it('returns 401 for a bad session', async () => {
    verifyWidgetSession.mockReturnValue(false);
    const response = await POST(request(body));
    expect(response.status).toBe(401);
    expect(createLeadFromWidget).not.toHaveBeenCalled();
  });

  it('returns 200, 409, 404, 400 and 503 from the core', async () => {
    const ok = await POST(request(body));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });

    createLeadFromWidget.mockResolvedValue({ ok: true, leadId: 'lead-1', duplicate: true, autoAccepted: false });
    const duplicate = await POST(request(body));
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ duplicate: true });

    createLeadFromWidget.mockResolvedValue({ ok: false, error: 'no_conversation' });
    expect((await POST(request(body))).status).toBe(404);

    createLeadFromWidget.mockResolvedValue({ ok: false, field: 'mobile', error: 'invalid' });
    const mobile = await POST(request(body));
    expect(mobile.status).toBe(400);
    expect(await mobile.json()).toEqual({ field: 'mobile', message: 'Please enter a UK mobile number.' });

    createLeadFromWidget.mockResolvedValue({ ok: false, error: 'save_failed' });
    const failed = await POST(request(body));
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ message: "Sorry, that didn't send — please try again." });
  });

  it('answers a preflight', async () => {
    preflightResponse.mockReturnValue(new Response(null, { status: 204 }));
    const response = OPTIONS(new Request('http://localhost:3000/api/widget/lead', { method: 'OPTIONS' }));
    expect(response.status).toBe(204);
  });
});
