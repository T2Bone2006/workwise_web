import type { TenantSettings } from '@/lib/data/settings-types';
import type { Look } from '@/components/look/use-look';

/**
 * Every business gets the new look: Rounds, Lite and Pro. There is no per-business switch any more
 * (owner, 2026-10-10: "I don't like accounts being gated behind a switch"). The arguments are kept so the
 * callers do not change; the classic components still exist in the code but nothing selects them.
 */
/* eslint-disable @typescript-eslint/no-unused-vars */
export function lookFromSettings(_isPro: boolean, _settings: TenantSettings | null): Look {
  return 'new';
}
