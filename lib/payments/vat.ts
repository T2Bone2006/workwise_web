import { roundMoney } from '@/lib/money/pence';

/**
 * VAT-inclusive split, same maths as create_invoice():
 * net = round(total / (1 + rate/100), 2), vat = total − net.
 */
export function splitVatInclusive(
  total: number,
  ratePercent: number,
): { net: number; vat: number } {
  const t = roundMoney(total);
  if (t === 0) return { net: 0, vat: 0 };
  const net = roundMoney(t / (1 + ratePercent / 100));
  const vat = roundMoney(t - net);
  return { net, vat };
}
