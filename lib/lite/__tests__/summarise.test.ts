import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ruleTags } from '@/lib/lite/summarise';
import type { GuardedQuote } from '@/lib/widget/turn-schema';

const harness = vi.hoisted(() => {
  const parse = vi.fn();
  const constructed: unknown[] = [];
  const logs: Array<{ inputData: unknown; parsedOutput: unknown; interactionType: string; prompt: string }> = [];
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
  logStructuredAiInteraction: async (
    _admin: unknown,
    params: { inputData: unknown; parsedOutput: unknown; interactionType: string; prompt: string },
  ) => {
    harness.logs.push(params);
  },
}));

import { summariseConversation } from '@/lib/lite/summarise';

const admin = {} as SupabaseClient;

const firm: GuardedQuote = { kind: 'firm', jobTypeKey: 'lock', amount: 85, summary: 'Back door lock' };

describe('ruleTags', () => {
  it('tags a booking with a firm price, and a chat that left no details', () => {
    expect(ruleTags({ hasLead: true, bookingRequested: true, lastQuote: firm })).toEqual([
      'lead',
      'booking',
      'firm_price',
    ]);
    expect(ruleTags({ hasLead: true, bookingRequested: false, lastQuote: { kind: 'guide', jobTypeKey: 'skim', min: 70, max: 120, summary: 'Skim' } })).toEqual([
      'lead',
      'guide_price',
    ]);
    expect(ruleTags({ hasLead: false, bookingRequested: false, lastQuote: { kind: 'visit', jobTypeKey: null, summary: 'Look' } })).toEqual([
      'no_details',
      'visit_offered',
    ]);
    expect(ruleTags({ hasLead: false, bookingRequested: true, lastQuote: null })).toEqual(['no_details']);
  });
});

describe('summariseConversation', () => {
  beforeEach(() => {
    harness.parse.mockReset();
    harness.constructed.length = 0;
    harness.logs.length = 0;
  });

  it('keeps a one-line summary and does not log the chat', async () => {
    harness.parse.mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: { summary: 'Back door lock in Bolton; quoted £85.', tags: ['question_only'] },
      usage: { input_tokens: 20, output_tokens: 30 },
    });
    const result = await summariseConversation(admin, {
      tenantId: 'tenant-1',
      conversationId: 'conv-1',
      businessName: "Dave's Plastering",
      messages: [
        { role: 'user', content: 'Back door lock in Bolton, my number is 07700 900123', at: 't' },
        { role: 'assistant', content: 'That would be £85.', at: 't' },
      ],
    });
    expect(result).toEqual({ summary: 'Back door lock in Bolton; quoted £85.', aiTags: ['question_only'] });
    expect(harness.parse).toHaveBeenCalledTimes(1);
    const [body, opts] = harness.parse.mock.calls[0] as [{ system: string; messages: { content: string }[] }, { timeout: number }];
    expect(opts).toEqual({ timeout: 15_000 });
    expect(harness.constructed[0]).toMatchObject({ maxRetries: 0 });
    expect(body.system).toContain("Summarise this website chat for Dave's Plastering");
    expect(body.system).toContain('at most 160 characters');
    expect(body.system).not.toContain('07700');
    expect(body.messages[0]?.content).toContain('visitor: Back door lock');
    expect(harness.logs[0]).toMatchObject({
      interactionType: 'conversation_summary',
      prompt: 'conversation_summary',
      inputData: { conversationId: 'conv-1' },
    });
    expect(JSON.stringify(harness.logs[0])).not.toContain('07700');
    expect(JSON.stringify(harness.logs[0])).not.toContain('Back door lock in Bolton');
  });

  it('returns no summary when the model fails', async () => {
    harness.parse.mockRejectedValueOnce(new Error('timeout'));
    await expect(
      summariseConversation(admin, {
        tenantId: 'tenant-1',
        conversationId: 'conv-2',
        businessName: "Dave's Plastering",
        messages: [{ role: 'user', content: 'Hello', at: 't' }],
      }),
    ).resolves.toEqual({ summary: null, aiTags: [] });
    expect(harness.logs.at(-1)?.parsedOutput).toEqual({ failed: true });
  });
});
