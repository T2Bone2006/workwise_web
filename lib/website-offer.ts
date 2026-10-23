/**
 * The free one-page website that comes with Lite. Built by Eden Technologies Ltd, hosted by WorkWise for as long as
 * Lite is paid. The customer keeps it only if they stay 12 months; leave sooner and the site comes down. There is no
 * contract: they can cancel any time, the website is what is conditional. Their domain is always theirs.
 * Anything bigger than one page is a separate Eden quote. See docs/specs/website-offer/PLAN.md.
 * Same wording as workwise_site `lib/site.ts` (`WEBSITE_OFFER`).
 */
export const WEBSITE_OFFER = { monthsToKeep: 12, builder: 'Eden Technologies' } as const;

/** The marketing site's form for anything bigger than one page. It emails the owner; nothing is paid there. */
export const WEBSITE_MORE_PAGES_URL = `${(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://joinworkwise.com').replace(/\/+$/, '')}/contact?about=website`;

export const WEBSITE_STATUSES = ['needs', 'building', 'done', 'has_one', 'taken_down'] as const;
export type WebsiteStatus = (typeof WEBSITE_STATUSES)[number];

export function isWebsiteStatus(value: unknown): value is WebsiteStatus {
  return typeof value === 'string' && (WEBSITE_STATUSES as readonly string[]).includes(value);
}

/** What the owner sees for each status on /admin/website. */
export const WEBSITE_STATUS_LABEL: Record<WebsiteStatus, string> = {
  needs: 'Needs a website',
  building: 'Building',
  done: 'Live',
  has_one: 'Has one already',
  taken_down: 'Taken down',
};

/** The day they have been on Lite long enough to keep the site: the start plus 12 calendar months. */
export function keepFromDate(liteStartedAt: Date): Date {
  const day = new Date(liteStartedAt.getTime());
  day.setUTCMonth(day.getUTCMonth() + WEBSITE_OFFER.monthsToKeep);
  return day;
}

export type LiteRunState = 'active' | 'ending' | 'ended';

/**
 * True when the site should be taken down: it exists or is being built, they have not reached 12 months, and Lite
 * has ended or is set to end before then. `liteEndsAt` is the end of the period they have paid for.
 */
export function shouldTakeDown(p: {
  status: WebsiteStatus;
  lite: LiteRunState;
  liteStartedAt: Date;
  liteEndsAt: Date | null;
}): boolean {
  if (p.status !== 'building' && p.status !== 'done') return false;
  if (p.lite === 'active') return false;
  const keepFrom = keepFromDate(p.liteStartedAt);
  if (p.lite === 'ended') {
    return (p.liteEndsAt ?? p.liteStartedAt).getTime() < keepFrom.getTime();
  }
  return p.liteEndsAt != null && p.liteEndsAt.getTime() < keepFrom.getTime();
}
