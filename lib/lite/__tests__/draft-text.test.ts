import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fallbackText, type TextContext } from '@/lib/lite/text-templates';

const harness = vi.hoisted(() => {
  const parse = vi.fn();
  const constructed: unknown[] = [];
  const logs: Array<{ inputData: unknown; parsedOutput: unknown; interactionType: string }> = [];
  return { parse, constructed, logs };
});

vi.mock('@anthropic-ai/sdk', () => ({
  default: class Anthropic {
    constructor(opts: unknown) {
      harness.constructed.push(opts);
    }
    messages = { parse: (...args: unknown[]) => harness.parse(...args) };
  },
}));

vi.mock('@/lib/services/ai-interaction-log', () => ({
  logStructuredAiInteraction: async (_admin: unknown, params: { inputData: unknown; parsedOutput: unknown; interactionType: string }) => {
    harness.logs.push(params);
  },
}));

import { draftLeadText } from '@/lib/lite/draft-text';

const admin = {} as SupabaseClient;

function ctx(overrides: Partial<TextContext> = {}): TextContext {
  return {
    first_name: 'Sarah',
    business_name: "Dave's Plastering",
    sign_off: 'Dave',
    trade: 'plastering',
    owner_mobile_display: '07700 900123',
    job_summary: 'Patch a wall',
    quote_kind: 'firm',
    allowed_amounts: [85],
    booking_requested: true,
    price_changed: false,
    preferred_days: ['mon'],
    link: 'https://secret.example/lead/abc',
    ...overrides,
  };
}

const good =
  "Hi Sarah, it's Dave. Happy to do the patch for £85. I'll message you from my own mobile (07700 900123). Dave";

describe('draftLeadText', () => {
  beforeEach(() => {
    harness.parse.mockReset();
    harness.constructed.length = 0;
    harness.logs.length = 0;
  });

  it('keeps an AI draft that passes the checks, and logs only the ids', async () => {
    harness.parse.mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: { text: good },
      usage: { input_tokens: 12, output_tokens: 30 },
    });
    const result = await draftLeadText(admin, {
      tenantId: 'tenant-1',
      textId: 'text-1',
      kind: 'follow_up',
      context: ctx(),
    });
    expect(result).toEqual({ body: good, draftedBy: 'ai' });
    expect(harness.parse).toHaveBeenCalledTimes(1);
    const [body, opts] = harness.parse.mock.calls[0] as [Record<string, unknown>, { timeout: number }];
    expect(opts).toEqual({ timeout: 15_000 });
    expect(harness.constructed[0]).toMatchObject({ maxRetries: 0 });
    const system = String(body.system);
    expect(system).toContain("End with 'Dave'");
    expect(system).toContain("Say you'll message them to confirm an exact price");
    expect(system).toContain('£85');
    expect(system).toContain('07700 900123');
    const user = String((body.messages as { content: string }[])[0]?.content);
    expect(user).not.toContain('secret.example');
    expect(user).not.toContain('link');
    expect(harness.logs[0]).toMatchObject({
      interactionType: 'lite_text_draft',
      inputData: { textId: 'text-1', kind: 'follow_up' },
      parsedOutput: { draftedBy: 'ai' },
    });
    expect(JSON.stringify(harness.logs[0])).not.toContain('07700 900123');
    expect(JSON.stringify(harness.logs[0])).not.toContain(good);
  });

  it('sends the fixed text when the draft has the wrong price, a link, or the model fails', async () => {
    const context = ctx({ allowed_amounts: [], booking_requested: false, quote_kind: null });
    const fixed = fallbackText('follow_up', context);

    harness.parse.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      parsed_output: { text: good.replace('£85', '£80') },
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await expect(
      draftLeadText(admin, { tenantId: 'tenant-1', textId: 'text-2', kind: 'follow_up', context: ctx() }),
    ).resolves.toMatchObject({ draftedBy: 'template' });

    harness.parse.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      parsed_output: { text: `${good} https://example.com` },
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await expect(
      draftLeadText(admin, { tenantId: 'tenant-1', textId: 'text-3', kind: 'follow_up', context: ctx() }),
    ).resolves.toMatchObject({ draftedBy: 'template' });

    harness.parse.mockRejectedValueOnce(new Error('timeout'));
    const failed = await draftLeadText(admin, {
      tenantId: 'tenant-1',
      textId: 'text-4',
      kind: 'follow_up',
      context,
    });
    expect(failed).toEqual({ body: fixed, draftedBy: 'template' });
    expect(harness.logs.at(-1)?.parsedOutput).toEqual({ failed: true, reason: 'ai' });
    expect(JSON.stringify(harness.logs.at(-1)?.inputData)).not.toContain('07700');
  });

  it('tells the model there is no price when none is allowed', async () => {
    harness.parse.mockResolvedValue({
      stop_reason: 'refusal',
      parsed_output: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    await draftLeadText(admin, {
      tenantId: 'tenant-1',
      textId: 'text-5',
      kind: 'booking_declined',
      context: ctx({ allowed_amounts: [], quote_kind: null, owner_mobile_display: null }),
    });
    const system = String((harness.parse.mock.calls[0] as [Record<string, unknown>])[0].system);
    expect(system).toContain('none \u2014 do not mention any price');
    expect(system).toContain("can't take on patch a wall");
    expect(system).not.toContain('07700 900123');
  });
});
