import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { STAGES, type Stage } from '@/lib/lite/interview-schema';

export type SetupStatus =
  | { state: 'not_started' }
  | { state: 'in_progress'; interviewId: string; stage: Stage }
  | { state: 'live'; profileVersion: number; website: string | null; redoInProgress: boolean };

function asStage(value: unknown): Stage {
  if (typeof value === 'string' && (STAGES as readonly string[]).includes(value)) return value as Stage;
  return 'areas';
}

/**
 * Live means a price profile has been saved. An interview still in progress
 * beside that profile is a redo, and the live profile stays as it is.
 */
export async function getSetupStatus(admin: SupabaseClient, tenantId: string): Promise<SetupStatus> {
  const [profileResult, openResult, widgetResult] = await Promise.all([
    admin.from('lite_price_profiles').select('version').eq('tenant_id', tenantId).maybeSingle(),
    admin.from('lite_interviews').select('id, stage').eq('tenant_id', tenantId).eq('status', 'in_progress').maybeSingle(),
    admin.from('widget_clients').select('website_url').eq('tenant_id', tenantId).maybeSingle(),
  ]);

  if (profileResult.error) throw new Error('Could not load setup');
  if (openResult.error) throw new Error('Could not load setup');

  const open = openResult.data as { id?: unknown; stage?: unknown } | null;
  const openId = typeof open?.id === 'string' ? open.id : null;

  const profile = profileResult.data as { version?: unknown } | null;
  if (profile) {
    const version = typeof profile.version === 'number' && profile.version >= 1 ? profile.version : 1;
    const websiteRaw = (widgetResult.data as { website_url?: unknown } | null)?.website_url;
    const website = typeof websiteRaw === 'string' && websiteRaw.trim() !== '' ? websiteRaw.trim() : null;
    return { state: 'live', profileVersion: version, website, redoInProgress: openId != null };
  }

  if (openId) return { state: 'in_progress', interviewId: openId, stage: asStage(open?.stage) };
  return { state: 'not_started' };
}
