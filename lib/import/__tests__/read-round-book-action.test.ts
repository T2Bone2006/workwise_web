import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = { count: 0 as number | null, countError: null as unknown, admin: true };

vi.mock('@/lib/ai/model', () => ({ ROUND_BOOK_AI_MODEL: 'claude-sonnet-5-5', supportsEffort: () => true }));
vi.mock('@/lib/data/tenant', () => ({ getTenantIdForCurrentUser: async () => 'tenant-1' }));
vi.mock('@/lib/data/tenant-products', () => ({ getTenantProducts: async () => ({ hasRounds: true }) }));
vi.mock('@/lib/stripe/connect', () => ({ isTenantAdmin: async () => state.admin }));
vi.mock('@/lib/services/ai-interaction-log', () => ({ logStructuredAiInteraction: vi.fn(async () => {}) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) } }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ eq: () => ({ gte: async () => ({ count: state.count, error: state.countError }) }) }) }),
      }),
    }),
  }),
}));
vi.mock('@/lib/import/round-book-core', async (orig) => {
  const real = await orig<typeof import('@/lib/import/round-book-core')>();
  return { ...real, readPageWithAi: vi.fn(async () => null) };
});

import { readRoundBook } from '@/lib/import/read-round-book';
import { ROUND_BOOK_ERRORS } from '@/lib/import/round-book-core';

function photoForm(n = 1) {
  const fd = new FormData();
  fd.set('kind', 'photos');
  for (let i = 0; i < n; i += 1) fd.append('file', new File([new Uint8Array(100)], `p${i}.jpg`, { type: 'image/jpeg' }));
  return fd;
}

describe('readRoundBook (server action)', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    state.count = 0;
    state.countError = null;
    state.admin = true;
  });

  it('only the account owner can use it', async () => {
    state.admin = false;
    expect(await readRoundBook(photoForm())).toEqual({ success: false, error: ROUND_BOOK_ERRORS.notOwner });
  });

  it('refuses when the day is used up', async () => {
    state.count = 30;
    expect(await readRoundBook(photoForm())).toEqual({ success: false, error: ROUND_BOOK_ERRORS.dailyLimit });
  });

  it('fails safe when it cannot count the day', async () => {
    state.countError = { message: 'boom' };
    expect(await readRoundBook(photoForm())).toEqual({ success: false, error: ROUND_BOOK_ERRORS.failed });
    state.countError = null;
    state.count = null;
    expect(await readRoundBook(photoForm())).toEqual({ success: false, error: ROUND_BOOK_ERRORS.failed });
  });

  it('a photo the AI cannot read ends as "couldn\'t read any customers"', async () => {
    expect(await readRoundBook(photoForm())).toEqual({ success: false, error: ROUND_BOOK_ERRORS.nothingRead });
  });
});
