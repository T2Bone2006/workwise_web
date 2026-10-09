import type { TenantSettings } from '@/lib/data/settings-types';
import type { Look } from '@/components/look/use-look';

/**
 * Pro businesses opt in to the new look one at a time with
 * `tenants.settings.look = 'new'`; nothing changes for them until that is set.
 * Rounds and Lite always get the new look.
 */
export function lookFromSettings(isPro: boolean, settings: TenantSettings | null): Look {
  if (!isPro) return 'new';
  return settings?.look === 'new' ? 'new' : 'classic';
}
