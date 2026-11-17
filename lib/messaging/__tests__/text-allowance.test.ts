import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { textAllowanceFor } from '@/lib/messaging/text-allowance';

function admin(rows: unknown[] | null, error: unknown = null) {
  return {
    from: () => ({ select: () => ({ eq: async () => ({ data: rows, error }) }) }),
  } as unknown as SupabaseClient;
}

describe('textAllowanceFor', () => {
  it('is 50 while the only plan is a free trial', async () => {
    expect(await textAllowanceFor(admin([{ product: 'rounds', status: 'trialing', source: 'stripe' }]), 't')).toBe(50);
    expect(
      await textAllowanceFor(
        admin([
          { product: 'rounds', status: 'trialing', source: 'stripe' },
          { product: 'lite', status: 'trialing', source: 'stripe' },
        ]),
        't',
      ),
    ).toBe(50);
  });

  it('is 100 once any plan is paid, manual or Pro', async () => {
    expect(await textAllowanceFor(admin([{ product: 'rounds', status: 'active', source: 'stripe' }]), 't')).toBe(100);
    expect(await textAllowanceFor(admin([{ product: 'rounds', status: 'manual', source: 'manual' }]), 't')).toBe(100);
    expect(await textAllowanceFor(admin([{ product: 'pro', status: 'trialing', source: 'stripe' }]), 't')).toBe(100);
  });

  it('is 100 when nothing is known, so a database blip never stops texts', async () => {
    expect(await textAllowanceFor(admin(null, { message: 'x' }), 't')).toBe(100);
    expect(await textAllowanceFor(admin([]), 't')).toBe(100);
  });
});
