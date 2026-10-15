import {
  PRO_PLANS,
  extraWorkerLabel,
  formatPoundsLong,
  proPriceLabel,
  type ProTier,
} from '@/lib/billing/pro-plans';

/** The words on the Upgrade cards and in the upgrade dialog, built once from numbers so text and button always agree. Pure. */

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function shortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(date);
}

export function upgradeCardLines(input: { from: ProTier; to: ProTier; interval: 'month' | 'year'; team: number }): {
  title: string;
  priceLine: string;
  includedLine: string;
  extraLine: string;
  effectLine: string;
  /** False when the team has no extras before or after, so effectLine is not worth a bullet. */
  hasExtrasEffect: boolean;
  /** "Room for 70 workers". */
  roomLine: string;
  /** What the bill is for this team today and on the bigger plan, in pence per period. */
  nowPence: number;
  afterPence: number;
  /** "Saves you £45 a month" / "Same bill as today" / "+£300 a month for room to grow". */
  deltaLine: string;
  deltaTone: 'save' | 'same' | 'more';
  /** Price of one extra worker now and after, e.g. "£12" and "£9" with the period, for "was" wording. */
  extraNowLabel: string;
  extraAfterLabel: string;
} {
  const { from, to, interval, team } = input;
  const target = PRO_PLANS[to];
  const current = PRO_PLANS[from];
  const currentExtras = Math.max(0, team - current.included);
  const newExtras = Math.max(0, team - target.included);
  const period = interval === 'month' ? 'a month' : 'a year';

  let effectLine: string;
  if (currentExtras === 0 && newExtras === 0) {
    effectLine = 'You have no extra workers today.';
  } else if (newExtras === 0) {
    effectLine = `Your ${plural(currentExtras, 'extra worker', 'extra workers')} (${formatPoundsLong(
      currentExtras * current.extraPence[interval],
    )} ${period}) ${currentExtras === 1 ? 'is' : 'are'} covered by the bigger plan.`;
  } else {
    effectLine = `Your extras drop from ${currentExtras} to ${newExtras}.`;
  }

  const nowPence = current.pence[interval] + currentExtras * current.extraPence[interval];
  const afterPence = target.pence[interval] + newExtras * target.extraPence[interval];
  const deltaPence = afterPence - nowPence;
  const deltaTone: 'save' | 'same' | 'more' = deltaPence < 0 ? 'save' : deltaPence === 0 ? 'same' : 'more';
  const deltaLine =
    deltaTone === 'save'
      ? `Saves you ${formatPoundsLong(-deltaPence)} ${period}`
      : deltaTone === 'same'
        ? 'Same bill as today'
        : `+${formatPoundsLong(deltaPence)} ${period} for room to grow`;

  return {
    hasExtrasEffect: currentExtras > 0 || newExtras > 0,
    roomLine: `Room for ${target.included} workers`,
    nowPence,
    afterPence,
    deltaLine,
    deltaTone,
    extraNowLabel: extraWorkerLabel({ tier: from, interval }),
    extraAfterLabel: extraWorkerLabel({ tier: to, interval }),
    title: target.name,
    priceLine: proPriceLabel({ tier: to, interval }),
    includedLine: `${target.included} workers included (you have ${team})`,
    extraLine: `Extra workers ${extraWorkerLabel({ tier: to, interval })} each`,
    effectLine,
  };
}

export function upgradeDialogLines(p: {
  target: ProTier;
  todayPence: number;
  thenLabel: string;
  renewsOn: string;
  overAfter: number;
  includedAfter: number;
}): { todayLine: string; thenLine: string; extrasLine: string; button: string } {
  const when = shortDate(p.renewsOn);
  const today = formatPoundsLong(p.todayPence);
  return {
    todayLine: p.todayPence > 0 ? `Today you pay ${today}` : 'Nothing to pay today',
    thenLine: when ? `then ${p.thenLabel} from ${when}` : `then ${p.thenLabel}`,
    extrasLine:
      p.overAfter === 0
        ? `Your plan now includes ${p.includedAfter} workers, so you have no extra workers.`
        : `You'll have ${plural(p.overAfter, 'extra worker', 'extra workers')} beyond the ${p.includedAfter} included.`,
    button: p.todayPence > 0 ? `Upgrade and pay ${today}` : `Upgrade to ${PRO_PLANS[p.target].name}`,
  };
}
