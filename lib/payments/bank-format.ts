/** '12-34-56' / '12 34 56' / '123456' → '123456'; else null */
export function normaliseSortCode(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (!/^\d{6}$/.test(digits)) return null;
  return digits;
}

/** '123456' → '12-34-56'; bad → '' */
export function formatSortCode(digits: string | null | undefined): string {
  if (!digits || !/^\d{6}$/.test(digits)) return '';
  return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 6)}`;
}

/**
 * Strips spaces; 8 digits → as is; 7 digits → left-pad '0'; else null.
 */
export function normaliseAccountNumber(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (/^\d{8}$/.test(digits)) return digits;
  if (/^\d{7}$/.test(digits)) return `0${digits}`;
  return null;
}

/** Masks for the dashboard list: '••••5678'. */
export function maskAccountNumber(digits: string | null | undefined): string {
  if (!digits || !/^\d{7,8}$/.test(digits)) return '';
  const last4 = digits.slice(-4);
  return `\u2022\u2022\u2022\u2022${last4}`;
}
