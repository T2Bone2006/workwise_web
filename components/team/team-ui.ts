/** A dialog that becomes a bottom sheet on a phone (the Team page is readable at 375 px). */
export const DIALOG_SHEET =
  'max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:max-w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:rounded-t-2xl max-sm:max-h-[92dvh] max-sm:overflow-y-auto';

/** "£10 a month" or "£100 a year" from a per-lead price in pence. */
export function perLeadLabel(pence: number, interval: 'month' | 'year' | null): string {
  const pounds = pence / 100;
  const amount = Number.isInteger(pounds) ? `£${pounds}` : `£${pounds.toFixed(2)}`;
  return `${amount} a ${interval === 'year' ? 'year' : 'month'}`;
}
