import { createAdminClient } from '@/lib/supabase/admin';
import { summariseSiteEvents, type SiteSummary, type StoredEvent } from '@/lib/analytics/site-events';

export const FUNNEL_DAYS = 14;
const PAGE_SIZE = 1000;
/** A safety stop: 30,000 events is far more than a 14-day test will make. */
const MAX_ROWS = 30_000;

export type SiteFunnelResult = { summary: SiteSummary; tableMissing: boolean; error: boolean };

const EMPTY: SiteSummary = {
  ads: [],
  pages: [],
  funnel: { views: 0, clickedStart: 0, plan: 0, details: 0, submitted: 0 },
};

/** What visitors did on the site over the last two weeks, for /admin/website. `ad` null = everyone. */
export async function getSiteFunnel(ad: string | null): Promise<SiteFunnelResult> {
  try {
    const admin = createAdminClient();
    const since = new Date(Date.now() - FUNNEL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const events: StoredEvent[] = [];

    for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
      const { data, error } = await admin
        .from('site_events')
        .select('visit, kind, page, ad_content, detail, value')
        .gte('created_at', since)
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) {
        if (error.code === '42P01') return { summary: EMPTY, tableMissing: true, error: false };
        throw new Error('site_events read failed');
      }
      events.push(...(data as StoredEvent[]));
      if (!data || data.length < PAGE_SIZE) break;
    }

    return { summary: summariseSiteEvents(events, ad), tableMissing: false, error: false };
  } catch (err) {
    console.error(`[getSiteFunnel] ${err instanceof Error ? err.name : 'Error'}`);
    return { summary: EMPTY, tableMissing: false, error: true };
  }
}
