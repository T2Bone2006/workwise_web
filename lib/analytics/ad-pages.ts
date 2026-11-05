/**
 * Where each Facebook ad sends people. Meta doesn't give the link back, so this follows the campaign notes in
 * docs/marketing/facebook/AD-COPY.md. Keep the two in step if an ad's destination ever changes.
 */

const SITE = 'https://joinworkwise.com';
const AD_TAGS = 'utm_source=facebook&utm_medium=paid&utm_campaign=founding-half-price';

export type AdPage = { ad: string; name: string; headline: string; path: string };

export const AD_PAGES: AdPage[] = [
  { ad: 'bundle', name: 'Ad 1 · Rounds + Lite bundle', headline: 'Run your round. Win the work.', path: '/pricing' },
  { ad: 'rounds', name: 'Ad 2 · Rounds', headline: "Get paid before you're back in the van", path: '/rounds' },
  { ad: 'lite', name: 'Ad 3 · Lite and free website', headline: 'A free website that quotes for you', path: '/lite' },
];

/**
 * The page exactly as an ad visitor gets it. `preview` adds ww_preview=1, which switches counting and the Facebook
 * Pixel off in that browser tab, so looking at the pages doesn't add visits to the tracker or tell Facebook.
 */
export function adPageUrl(page: AdPage, preview = true): string {
  return `${SITE}${page.path}?${AD_TAGS}&utm_content=${page.ad}${preview ? '&ww_preview=1' : ''}`;
}
