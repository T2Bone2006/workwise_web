import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('next/cache', () => ({ unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc }) }));

import { getFoundingStatus } from '@/lib/billing/offers';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getFoundingStatus', () => {
  it('counts the places in use from the database', async () => {
    rpc.mockResolvedValue({ data: 150, error: null });
    await expect(getFoundingStatus()).resolves.toEqual({ active: true, placesLeft: 50, places: 200 });
    expect(rpc).toHaveBeenCalledWith('founder_places_taken');
  });

  it('closes the offer when all 200 are taken', async () => {
    rpc.mockResolvedValue({ data: 200, error: null });
    await expect(getFoundingStatus()).resolves.toEqual({ active: false, placesLeft: 0, places: 200 });
  });

  it('never shows a negative count', async () => {
    rpc.mockResolvedValue({ data: 203, error: null });
    await expect(getFoundingStatus()).resolves.toEqual({ active: false, placesLeft: 0, places: 200 });
  });

  it('says "unknown" when the database cannot be read (the offer still shows, with no count)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'function does not exist' } });
    await expect(getFoundingStatus()).resolves.toEqual({ active: null, placesLeft: null, places: 200 });
  });
});
