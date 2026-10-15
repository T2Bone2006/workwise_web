/** Pounds → integer pence. Throws on NaN/Infinity. */
export function toPence(pounds: number): number {
  if (!Number.isFinite(pounds)) {
    throw new Error(`toPence: not a finite number (${pounds})`);
  }
  return Math.round(Number((pounds * 100).toFixed(4)));
}

export function fromPence(pence: number): number {
  if (!Number.isFinite(pence)) {
    throw new Error(`fromPence: not a finite number (${pence})`);
  }
  return roundMoney(pence / 100);
}

/** Round a pounds value to 2dp via pence. */
export function roundMoney(pounds: number): number {
  return toPence(pounds) / 100;
}

/**
 * '£15', '£15.50', '£1,250', '−£5' — en-GB, GBP.
 * Whole pounds show no decimals unless always2dp.
 * null/undefined → '£0'.
 */
export function formatGbp(
  pounds: number | null | undefined,
  opts?: { always2dp?: boolean },
): string {
  if (pounds == null || Number.isNaN(pounds)) {
    return opts?.always2dp ? '£0.00' : '£0';
  }
  if (!Number.isFinite(pounds)) {
    throw new Error(`formatGbp: not a finite number (${pounds})`);
  }
  const rounded = roundMoney(pounds);
  const negative = rounded < 0;
  const abs = Math.abs(rounded);
  const always2dp = opts?.always2dp === true;
  const showDecimals = always2dp || abs % 1 !== 0;
  const body = abs.toLocaleString('en-GB', {
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  });
  return `${negative ? '\u2212' : ''}£${body}`;
}

/**
 * Accepts '15', '15.5', '£15.50', ' 1,250 ' → pounds;
 * null when unreadable or < 0.
 */
export function parseMoneyInput(raw: string): number | null {
  const cleaned = raw.replace(/£/g, '').replace(/,/g, '').trim();
  if (!cleaned) return null;
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return roundMoney(n);
}
