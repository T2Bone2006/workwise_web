import { createAdminClient } from '@/lib/supabase/admin';
import { summariseSiteEvents, type SiteSummary, type StoredEvent } from '@/lib/analytics/site-events';
import { summarisePeople, type PeopleSummary } from '@/lib/analytics/site-people';

export const FUNNEL_DAYS = 14;
const PAGE_SIZE = 1000;
/** A safety stop: 30,000 events is far more than a 14-day test will make. */
const MAX_ROWS = 30_000;

export type SiteFunnelResult = {
  /** When these numbers were loaded, as a London clock time. */
  loadedAt: string;
  summary: SiteSummary;
  /** The visitors who pressed Accept, followed from page to page. */
  people: PeopleSummary;
  tableMissing: boolean;
  /** The "person" column hasn't been added to the table yet. */
  personMissing: boolean;
  error: boolean;
};

const EMPTY: SiteSummary = {
  ads: [],
  pages: [],
  funnel: { views: 0, clickedStart: 0, plan: 0, details: 0, submitted: 0 },
};
const EMPTY_PEOPLE: PeopleSummary = summarisePeople([], null);

/** What visitors did on the site over the last two weeks, for /admin/website. `ad` null = everyone. */
export async function getSiteFunnel(ad: string | null): Promise<SiteFunnelResult> {
  const loadedAt = new Date().toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return { ...(await loadSiteFunnel(ad)), loadedAt };
}

async function loadSiteFunnel(ad: string | null): Promise<Omit<SiteFunnelResult, 'loadedAt'>> {
  try {
    const admin = createAdminClient();
    const since = new Date(Date.now() - FUNNEL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const events: StoredEvent[] = [];
    let columns = 'visit, kind, page, ad_content, detail, value, person, created_at';
    let personMissing = false;

    for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
      const { data, error } = await admin
        .from('site_events')
        .select(columns)
        .gte('created_at', since)
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) {
        if (error.code === '42P01') return { summary: EMPTY, people: EMPTY_PEOPLE, tableMissing: true, personMissing: false, error: false };
        // The person column is added by a second SQL paste; until then read without it and say so.
        if (!personMissing && (error.code === '42703' || error.code === 'PGRST204' || error.code === 'PGRST200')) {
          personMissing = true;
          columns = 'visit, kind, page, ad_content, detail, value, created_at';
          from -= PAGE_SIZE;
          events.length = 0;
          continue;
        }
        throw new Error('site_events read failed');
      }
      events.push(...((data ?? []) as unknown as StoredEvent[]));
      if (!data || data.length < PAGE_SIZE) break;
    }

    return {
      summary: summariseSiteEvents(events, ad),
      people: summarisePeople(events, ad),
      tableMissing: false,
      personMissing,
      error: false,
    };
  } catch (err) {
    console.error(`[getSiteFunnel] ${err instanceof Error ? err.name : 'Error'}`);
    return { summary: EMPTY, people: EMPTY_PEOPLE, tableMissing: false, personMissing: false, error: true };
  }
}
