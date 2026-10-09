import { PRO_PLANS, formatPoundsLong, type ProTier } from '@/lib/billing/pro-plans';
import { yearlySwitchFigures } from '@/lib/billing/pro-manage-core';

/** The words on the "Switch to yearly" block and dialog, built from numbers so text and button always agree. Pure. */

function longDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}

export function yearlyBlockLines(input: { tier: ProTier; extras: number }): {
  headline: string;
  yearlyPence: number;
  yearlyLabel: string;
  comparison: string;
  savesPence: number;
  savesLabel: string;
  detail: string;
} {
  const plan = PRO_PLANS[input.tier];
  const figures = yearlySwitchFigures({
    planMonthlyPence: plan.pence.month,
    extraMonthlyPence: plan.extraPence.month,
    planYearlyPence: plan.pence.year,
    extraYearlyPence: plan.extraPence.year,
    extras: input.extras,
  });
  const extrasText =
    input.extras > 0
      ? `${plan.name} plan ${formatPoundsLong(plan.pence.year)} + ${input.extras} extra ${input.extras === 1 ? 'worker' : 'workers'} × ${formatPoundsLong(plan.extraPence.year)}`
      : `${plan.name} plan, ${plan.included} workers included`;
  return {
    headline: 'Pay yearly and get 2 months free',
    yearlyPence: figures.yearlyPence,
    yearlyLabel: `${formatPoundsLong(figures.yearlyPence)} a year`,
    comparison: `instead of ${formatPoundsLong(figures.yearOfMonthsPence)} over 12 months`,
    savesPence: figures.savesPence,
    savesLabel: `Save ${formatPoundsLong(figures.savesPence)}`,
    detail: extrasText,
  };
}

export function yearlyDialogLines(p: {
  todayPence: number;
  creditPence: number;
  yearlyPence: number;
  savesPence: number;
  startsOn: string;
  renewsOn: string;
}): { todayLine: string; creditLine: string | null; yearLine: string; savesLine: string; button: string } {
  const today = formatPoundsLong(p.todayPence);
  const starts = longDate(p.startsOn);
  const renews = longDate(p.renewsOn);
  return {
    todayLine: p.todayPence > 0 ? `Today you pay ${today}` : 'Nothing to pay today',
    creditLine:
      p.creditPence > 0
        ? `That is the yearly price minus ${formatPoundsLong(p.creditPence)} back for the unused part of this month.`
        : null,
    yearLine: `Your year starts today${starts ? ` (${starts})` : ''}. Your next yearly bill is ${formatPoundsLong(p.yearlyPence)} on ${renews || 'the same date next year'}.`,
    savesLine: `Compared with paying monthly for a year, you save ${formatPoundsLong(p.savesPence)}.`,
    button: p.todayPence > 0 ? `Switch and pay ${today}` : 'Switch to yearly',
  };
}
