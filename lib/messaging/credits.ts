export const TEXT_ALLOWANCE_PER_MONTH = 100;

export const TEXT_PACKS = [
  {
    key: 'texts_250' as const,
    texts: 250,
    pricePence: 1000,
    label: '250 texts',
    priceEnv: 'STRIPE_PRICE_TEXTS_250' as const,
  },
  {
    key: 'texts_1000' as const,
    texts: 1000,
    pricePence: 3500,
    label: '1,000 texts',
    priceEnv: 'STRIPE_PRICE_TEXTS_1000' as const,
  },
] as const;

export type TextPackKey = (typeof TEXT_PACKS)[number]['key'];

export function textPackByKey(key: string): (typeof TEXT_PACKS)[number] | null {
  return TEXT_PACKS.find((p) => p.key === key) ?? null;
}

export type TextBalanceRow = {
  month: string;
  month_used: number;
  pack_balance: number;
};

/** A row from another month counts as 0 used this month. No row = fresh. */
export function summariseTexts(
  row: TextBalanceRow | null,
  currentMonth: string,
): {
  freeUsed: number;
  freeLeft: number;
  packLeft: number;
  totalLeft: number;
  allowance: number;
} {
  const allowance = TEXT_ALLOWANCE_PER_MONTH;
  if (row == null) {
    return {
      freeUsed: 0,
      freeLeft: allowance,
      packLeft: 0,
      totalLeft: allowance,
      allowance,
    };
  }
  const freeUsed = row.month === currentMonth ? row.month_used : 0;
  const freeLeft = Math.max(allowance - freeUsed, 0);
  const packLeft = Math.max(row.pack_balance, 0);
  return {
    freeUsed,
    freeLeft,
    packLeft,
    totalLeft: freeLeft + packLeft,
    allowance,
  };
}
